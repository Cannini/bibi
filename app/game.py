import random
import string
import time
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from app.models import CreateRoomRequest, UpdateRoomRequest
from app.redis_store import RedisStore


ROUND_DURATION_SECONDS = 120
WINNING_SCORE = 100
DEFAULT_MAX_ROUNDS = 6


class GameService:
    def __init__(self, store: RedisStore) -> None:
        self.store = store

    async def create_room(self, request: CreateRoomRequest) -> tuple[dict[str, Any], str]:
        room_id = uuid4().hex[:6].upper()
        player_id = uuid4().hex

        room = {
            "id": room_id,
            "status": "lobby",
            "categories": self._normalize_categories(request.categories),
            "letters": self._normalize_letters(request.letters),
            "current_letter": None,
            "round_number": 0,
            "max_rounds": request.max_rounds,
            "host_id": player_id,
            "players": {player_id: request.host_name.strip()},
            "scores": {player_id: 0},
            "last_round_scores": {},
            "answers": {},
            "votes": {},
            "events": [],
            "review_category_index": 0,
            "review_category_started_at": None,
            "stopped_by": None,
            "round_started_at": None,
            "round_duration_seconds": request.round_duration_seconds,
            "winner_id": None,
        }
        self._append_event(room, "system", f"{request.host_name.strip()} criou a sala.", player_id)
        await self.store.save_room(room)
        return room, player_id

    async def join_room(self, room_id: str, player_name: str) -> tuple[dict[str, Any], str]:
        room = await self.require_room(room_id)
        if room["status"] != "lobby":
            raise HTTPException(status.HTTP_409_CONFLICT, "A sala ja esta em rodada.")

        player_id = uuid4().hex
        room["players"][player_id] = player_name.strip()
        room["scores"][player_id] = 0
        self._append_event(room, "system", f"{player_name.strip()} entrou na sala.", player_id)
        await self.store.save_room(room)
        return room, player_id

    async def update_room(self, room_id: str, request: UpdateRoomRequest) -> dict[str, Any]:
        room = await self.require_room(room_id)
        
        # NOVA VALIDAÇÃO: Verifica se o jogador existe na sala e se ele é o líder
        self._require_player(room, request.player_id)
        if request.player_id != room.get("host_id"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, 
                "Apenas o líder da sala pode alterar as configurações."
            )

        if room["status"] != "lobby":
            raise HTTPException(status.HTTP_409_CONFLICT, "Configuracoes so podem mudar no lobby.")

        room["categories"] = self._normalize_categories(request.categories)
        room["letters"] = self._normalize_letters(request.letters)
        room["max_rounds"] = request.max_rounds
        room["round_duration_seconds"] = request.round_duration_seconds
        await self.store.save_room(room)
        return room

    async def start_round(self, room_id: str, player_id: str) -> dict[str, Any]:
        room = await self.require_room(room_id)
        self._require_player(room, player_id)
        if player_id != room.get("host_id"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas o dono da sala pode iniciar rodadas.")
        if room.get("winner_id"):
            raise HTTPException(status.HTTP_409_CONFLICT, "A sala ja possui um vencedor.")
        if room["status"] not in {"lobby", "finished"}:
            raise HTTPException(status.HTTP_409_CONFLICT, "A sala ja possui uma rodada ativa.")

        room["status"] = "playing"
        room["round_number"] += 1
        room["current_letter"] = random.choice(room["letters"])
        room["round_started_at"] = int(time.time())
        room["round_duration_seconds"] = room.get("round_duration_seconds", ROUND_DURATION_SECONDS)
        room["last_round_scores"] = {}
        room["answers"] = {}
        room["votes"] = {}
        room["stopped_by"] = None
        room["review_category_index"] = 0
        room["review_category_started_at"] = None
        self._append_event(
            room,
            "system",
            f"Rodada {room['round_number']} iniciada com a letra {room['current_letter']}.",
            player_id,
        )
        await self.store.save_room(room)
        return room

    async def submit_answers(self, room_id: str, player_id: str, answers: dict[str, str]) -> dict[str, Any]:
        room = await self.require_room(room_id)
        self._require_playing(room)
        self._require_player(room, player_id)

        room["answers"][player_id] = self._filter_answers(room["categories"], answers)
        await self.store.save_room(room)
        return room

    async def stop_round(self, room_id: str, player_id: str, answers: dict[str, str], force: bool = False) -> dict[str, Any]:
        room = await self.require_room(room_id)
        self._require_playing(room)
        self._require_player(room, player_id)
        filtered_answers = self._filter_answers(room["categories"], answers)
        if not force and not all(filtered_answers[category] for category in room["categories"]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Preencha todos os campos antes de pedir STOP.")

        room["answers"][player_id] = filtered_answers
        room["status"] = "voting"
        room["stopped_by"] = None if force else player_id
        room["votes"] = self._build_initial_votes(room)
        room["review_category_index"] = 0
        room["review_category_started_at"] = int(time.time())
        player_name = room["players"].get(player_id, "Um jogador")
        message = "Tempo esgotado. Rodada encerrada automaticamente." if force else f"{player_name} pediu STOP."
        self._append_event(room, "system", message, player_id)
        await self.store.save_room(room)
        return room

    async def advance_review_category(self, room_id: str, player_id: str, expected_index: int) -> dict[str, Any]:
        room = await self.require_room(room_id)
        self._require_player(room, player_id)
        if room["status"] != "voting":
            raise HTTPException(status.HTTP_409_CONFLICT, "A sala nao esta em fase de votacao.")

        current_index = room.get("review_category_index", 0)
        if current_index != expected_index:
            return room
        if current_index >= len(room["categories"]) - 1:
            return await self.finish_round(room_id, player_id)

        room["review_category_index"] = current_index + 1
        room["review_category_started_at"] = int(time.time())
        await self.store.save_room(room)
        return room

    async def vote_answer(
        self,
        room_id: str,
        voter_id: str,
        target_player_id: str,
        category: str,
        valid: bool,
    ) -> dict[str, Any]:
        room = await self.require_room(room_id)
        if room["status"] != "voting":
            raise HTTPException(status.HTTP_409_CONFLICT, "A sala nao esta em fase de votacao.")
        self._require_player(room, voter_id)
        self._require_player(room, target_player_id)
        if category not in room["categories"]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria nao encontrada.")

        vote_key = f"{target_player_id}:{category}"
        answer = room["answers"].get(target_player_id, {}).get(category, "").strip()
        room["votes"].setdefault(vote_key, {})
        room["votes"][vote_key][voter_id] = valid and bool(answer)
        await self.store.save_room(room)
        return room

    async def finish_round(self, room_id: str, player_id: str) -> dict[str, Any]:
        room = await self.require_room(room_id)
        self._require_player(room, player_id)
        if room["status"] != "voting":
            raise HTTPException(status.HTTP_409_CONFLICT, "Pontuação só pode ser calculada na votação.")

        score_delta = self._calculate_score(room)
        for player, score in score_delta.items():
            room["scores"][player] = room["scores"].get(player, 0) + score

        room["last_round_scores"] = score_delta
        room["status"] = "finished"
        room["review_category_started_at"] = None
        room["winner_id"] = self._find_winner(room)
        if room["winner_id"]:
            winner_name = room["players"].get(room["winner_id"], "Um jogador")
            self._append_event(room, "system", f"{winner_name} venceu a sala.", room["winner_id"])
        else:
            self._append_event(room, "system", "Rodada concluída. Pontuação atualizada.", player_id)
        await self.store.save_room(room)
        return room

    async def add_chat_message(self, room_id: str, player_id: str, message: str) -> dict[str, Any]:
        room = await self.require_room(room_id)
        self._require_player(room, player_id)
        player_name = room["players"].get(player_id, "Jogador")
        self._append_event(room, "chat", f"{player_name}: {message.strip()}", player_id)
        await self.store.save_room(room)
        return room

    async def leave_room(self, room_id: str, player_id: str) -> dict[str, Any]:
        room = await self.require_room(room_id)
        self._require_player(room, player_id)
        player_name = room["players"].get(player_id, "Um jogador")
        self._append_event(room, "system", f"{player_name} saiu da sala.", player_id)
        room["players"].pop(player_id, None)
        room["scores"].pop(player_id, None)
        room["answers"].pop(player_id, None)
        room["last_round_scores"].pop(player_id, None)
        room["votes"] = {
            vote_key: {
                voter_id: valid
                for voter_id, valid in votes.items()
                if voter_id == "system" or voter_id != player_id
            }
            for vote_key, votes in room["votes"].items()
            if not vote_key.startswith(f"{player_id}:")
        }
        if room.get("host_id") == player_id:
            room["host_id"] = next(iter(room["players"]), None)
        if room.get("stopped_by") == player_id:
            room["stopped_by"] = None
        if room.get("winner_id") == player_id:
            room["winner_id"] = self._find_winner(room) if room["players"] else None
        await self.store.save_room(room)
        return room

    async def require_room(self, room_id: str) -> dict[str, Any]:
        room = await self.store.get_room(room_id.upper())
        if room is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sala nao encontrada.")
        room.setdefault("events", [])
        room.setdefault("review_category_index", 0)
        room.setdefault("review_category_started_at", None)
        room.setdefault("max_rounds", DEFAULT_MAX_ROUNDS)
        room.setdefault("round_duration_seconds", ROUND_DURATION_SECONDS)
        if "host_id" not in room and room.get("players"):
            room["host_id"] = next(iter(room["players"]))
        return room

    def _calculate_score(self, room: dict[str, Any]) -> dict[str, int]:
        score_delta = {player_id: 0 for player_id in room["players"]}

        for category in room["categories"]:
            normalized_answers: dict[str, list[str]] = {}
            for player_id, answers in room["answers"].items():
                answer = answers.get(category, "").strip()
                if not self._is_answer_valid(room, player_id, category, answer):
                    continue
                normalized_answers.setdefault(answer.casefold(), []).append(player_id)

            for player_ids in normalized_answers.values():
                points = 10 if len(player_ids) == 1 else 5
                for player_id in player_ids:
                    score_delta[player_id] += points

        return score_delta

    @staticmethod
    def _find_winner(room: dict[str, Any]) -> str | None:
        reached_score = [
            player_id
            for player_id, score in room["scores"].items()
            if score >= WINNING_SCORE
        ]
        reached_round_limit = room.get("round_number", 0) >= room.get("max_rounds", DEFAULT_MAX_ROUNDS)
        if not reached_score and not reached_round_limit:
            return None
        candidates = reached_score or list(room["scores"])
        return max(candidates, key=lambda player_id: room["scores"][player_id])

    def _is_answer_valid(self, room: dict[str, Any], player_id: str, category: str, answer: str) -> bool:
        if not answer:
            return False

        votes = room["votes"].get(f"{player_id}:{category}", {})
        if not votes:
            return True
        player_votes = {voter: valid for voter, valid in votes.items() if voter != "system"}
        if not player_votes:
            return votes.get("system", True)
        positive_votes = sum(1 for valid in player_votes.values() if valid)
        return positive_votes >= len(player_votes) / 2

    def _build_initial_votes(self, room: dict[str, Any]) -> dict[str, dict[str, bool]]:
        votes: dict[str, dict[str, bool]] = {}
        for player_id, answers in room["answers"].items():
            for category in room["categories"]:
                answer = answers.get(category, "").strip()
                is_valid_by_default = bool(answer) and answer.upper().startswith(room["current_letter"])
                votes[f"{player_id}:{category}"] = {"system": is_valid_by_default}
        return votes

    @staticmethod
    def _append_event(room: dict[str, Any], event_type: str, message: str, player_id: str | None = None) -> None:
        room.setdefault("events", [])
        room["events"].append(
            {
                "type": event_type,
                "message": message,
                "playerId": player_id,
                "createdAt": int(time.time()),
            }
        )
        room["events"] = room["events"][-80:]

    @staticmethod
    def _filter_answers(categories: list[str], answers: dict[str, str]) -> dict[str, str]:
        return {category: answers.get(category, "").strip() for category in categories}

    @staticmethod
    def _normalize_categories(categories: list[str]) -> list[str]:
        normalized = []
        for category in categories:
            clean_category = category.strip()
            if clean_category and clean_category not in normalized:
                normalized.append(clean_category)
        if len(normalized) < 5:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe pelo menos cinco categorias.")
        return normalized

    @staticmethod
    def _normalize_letters(letters: list[str]) -> list[str]:
        normalized = []
        for letter in letters:
            clean_letter = letter.strip().upper()
            if len(clean_letter) == 1 and clean_letter in string.ascii_uppercase and clean_letter not in normalized:
                normalized.append(clean_letter)
        if len(normalized) < 3:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe pelo menos tres letras validas.")
        return normalized

    @staticmethod
    def _require_player(room: dict[str, Any], player_id: str) -> None:
        if player_id not in room["players"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Jogador nao pertence a sala.")

    @staticmethod
    def _require_playing(room: dict[str, Any]) -> None:
        if room["status"] != "playing":
            raise HTTPException(status.HTTP_409_CONFLICT, "A sala nao esta em rodada.")
