from typing import Literal

from pydantic import BaseModel, Field


class CreateRoomRequest(BaseModel):
    host_name: str = Field(min_length=2, max_length=30)
    categories: list[str] = Field(
        default_factory=lambda: ["Nome", "CEP", "Animal", "Comida", "Cor", "Objeto"],
        min_length=5,
        max_length=20,
    )
    letters: list[str] = Field(default_factory=lambda: list("ABCDEFGHIJKLMNOPQRSTUV"), min_length=3)
    max_rounds: int = Field(default=6, ge=1, le=15)
    round_duration_seconds: int = Field(default=120, ge=60, le=600)


class JoinRoomRequest(BaseModel):
    player_name: str = Field(min_length=2, max_length=30)


class UpdateRoomRequest(BaseModel):
    player_id: str # NOVO: Necessário para validar quem está fazendo a requisição
    categories: list[str] = Field(min_length=5, max_length=20)
    letters: list[str] = Field(min_length=3, max_length=26)
    max_rounds: int = Field(ge=1, le=15)
    round_duration_seconds: int = Field(ge=60, le=600)


class StartRoundRequest(BaseModel):
    player_id: str


class AdvanceReviewRequest(BaseModel):
    player_id: str
    review_category_index: int


class SubmitAnswersRequest(BaseModel):
    player_id: str
    answers: dict[str, str]


class StopRoundRequest(BaseModel):
    player_id: str
    answers: dict[str, str]
    force: bool = False


class VoteRequest(BaseModel):
    voter_id: str
    target_player_id: str
    category: str
    valid: bool


class ChatMessageRequest(BaseModel):
    player_id: str
    message: str = Field(min_length=1, max_length=180)


class RoomResponse(BaseModel):
    id: str
    status: Literal["lobby", "playing", "voting", "finished"]
    categories: list[str]
    letters: list[str]
    current_letter: str | None = None
    round_number: int = 0
    max_rounds: int = 6
    host_id: str | None = None
    players: dict[str, str]
    scores: dict[str, int]
    last_round_scores: dict[str, int] = Field(default_factory=dict)
    answers: dict[str, dict[str, str]]
    votes: dict[str, dict[str, bool]]
    events: list[dict[str, str | int | None]] = Field(default_factory=list)
    review_category_index: int = 0
    review_category_started_at: int | None = None
    round_started_at: int | None = None
    round_duration_seconds: int = 120
    winner_id: str | None = None
