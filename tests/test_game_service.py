import pytest
from fastapi import HTTPException

from app.game import GameService


class MemoryStore:
    def __init__(self) -> None:
        self.rooms: dict[str, dict] = {}

    async def get_room(self, room_id: str) -> dict | None:
        return self.rooms.get(room_id)

    async def save_room(self, room: dict) -> None:
        self.rooms[room["id"]] = room


def make_room() -> dict:
    return {
        "id": "ABC123",
        "status": "playing",
        "categories": ["Nome", "CEP", "Animal", "Comida", "Cor"],
        "letters": ["A", "B", "C"],
        "current_letter": "A",
        "round_number": 1,
        "max_rounds": 6,
        "host_id": "p1",
        "players": {"p1": "Ana", "p2": "Beto"},
        "scores": {"p1": 0, "p2": 0},
        "last_round_scores": {},
        "answers": {},
        "votes": {},
        "events": [],
        "review_category_index": 0,
        "review_category_started_at": None,
        "stopped_by": None,
        "round_started_at": 1,
        "round_duration_seconds": 60,
        "winner_id": None,
    }


@pytest.mark.asyncio
async def test_manual_stop_still_requires_all_answers() -> None:
    store = MemoryStore()
    store.rooms["ABC123"] = make_room()
    service = GameService(store)

    with pytest.raises(HTTPException) as exc:
        await service.stop_round("ABC123", "p1", {"Nome": "Ana"})

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_forced_stop_allows_incomplete_answers_on_timeout() -> None:
    store = MemoryStore()
    store.rooms["ABC123"] = make_room()
    service = GameService(store)

    room = await service.stop_round("ABC123", "p1", {"Nome": "Ana"}, force=True)

    assert room["status"] == "voting"
    assert room["stopped_by"] is None
    assert room["answers"]["p1"]["Nome"] == "Ana"
    assert room["answers"]["p1"]["CEP"] == ""


@pytest.mark.asyncio
async def test_leave_room_removes_player_data_and_transfers_host() -> None:
    store = MemoryStore()
    room = make_room()
    room["answers"] = {"p1": {"Nome": "Ana"}, "p2": {"Nome": "Beto"}}
    room["votes"] = {"p1:Nome": {"p2": True}, "p2:Nome": {"p1": True, "system": True}}
    room["last_round_scores"] = {"p1": 10, "p2": 5}
    store.rooms["ABC123"] = room
    service = GameService(store)

    updated_room = await service.leave_room("ABC123", "p1")

    assert "p1" not in updated_room["players"]
    assert "p1" not in updated_room["scores"]
    assert "p1" not in updated_room["answers"]
    assert "p1" not in updated_room["last_round_scores"]
    assert "p1:Nome" not in updated_room["votes"]
    assert "p1" not in updated_room["votes"]["p2:Nome"]
    assert updated_room["host_id"] == "p2"
