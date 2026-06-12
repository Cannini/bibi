import logging
from collections import defaultdict
from typing import Any

from fastapi import Header, HTTPException, FastAPI, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.game import GameService
from app.models import (
    AdvanceReviewRequest,
    ChatMessageRequest,
    CreateRoomRequest,
    JoinRoomRequest,
    StartRoundRequest,
    StopRoundRequest,
    SubmitAnswersRequest,
    UpdateRoomRequest,
    VoteRequest,
)
from app.rabbitmq import RabbitPublisher
from app.redis_store import RedisStore
from app.config import settings
from app.network import build_join_url, build_network_info, generate_qr_code_png

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Stop Game API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

store = RedisStore()
game_service = GameService(store)
rabbit = RabbitPublisher()


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, list[WebSocket]] = defaultdict(list)
        self.connection_players: dict[WebSocket, str | None] = {}

    async def connect(self, room_id: str, websocket: WebSocket, player_id: str | None = None) -> None:
        await websocket.accept()
        self.active_connections[room_id].append(websocket)
        self.connection_players[websocket] = player_id

    def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        if websocket in self.active_connections[room_id]:
            self.active_connections[room_id].remove(websocket)
        self.connection_players.pop(websocket, None)

    def presence(self, room_id: str) -> dict[str, str]:
        online_players = {
            player_id
            for websocket in self.active_connections[room_id]
            if (player_id := self.connection_players.get(websocket))
        }
        return {player_id: "online" for player_id in online_players}

    async def broadcast(self, room_id: str, message: dict[str, Any]) -> None:
        disconnected: list[WebSocket] = []
        for websocket in self.active_connections[room_id]:
            try:
                await websocket.send_json(message)
            except RuntimeError:
                disconnected.append(websocket)

        for websocket in disconnected:
            self.disconnect(room_id, websocket)


manager = ConnectionManager()


@app.on_event("startup")
async def startup() -> None:
    await rabbit.connect()


@app.on_event("shutdown")
async def shutdown() -> None:
    await rabbit.close()
    await store.close()


@app.get("/api/v1/network/info")
async def network_info(request: Request) -> dict[str, Any]:
    info = build_network_info(request)
    return {
        "data": {
            "ipv4": info.ipv4,
            "port": info.port,
            "baseUrl": info.base_url,
        }
    }


@app.get("/api/v1/network/qr-code")
async def network_qr_code(request: Request, room: str | None = None) -> Response:
    info = build_network_info(request)
    join_url = build_join_url(info, room)
    png = generate_qr_code_png(join_url)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("app/static/index.html")


@app.get("/demo")
async def demo() -> FileResponse:
    return FileResponse("app/static/index.html")


@app.get("/assets/stop-time-icon.png")
async def stop_time_icon() -> FileResponse:
    return FileResponse("app/stopTimeIcon.png")


@app.post("/api/v1/rooms", status_code=201)
async def create_room(request: CreateRoomRequest) -> dict[str, Any]:
    room, player_id = await game_service.create_room(request)
    await emit_room_event("room.created", room, {"playerId": player_id})
    return {"data": room, "playerId": player_id}


@app.get("/api/v1/rooms/{room_id}")
async def get_room(room_id: str) -> dict[str, Any]:
    room = await game_service.require_room(room_id)
    return {"data": room}


@app.get("/api/v1/dev/cache/status")
async def cache_status(x_dsm_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_dev_panel_access(x_dsm_token)
    data = await store.diagnostics()
    data["rabbitmq"] = rabbit.diagnostics()
    return {"data": data}


@app.post("/api/v1/dev/cache/clear")
async def clear_cache(room_id: str | None = None, x_dsm_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_dev_panel_access(x_dsm_token)
    deleted = await store.clear_cache(room_id)
    return {"deleted": deleted, "roomId": room_id.upper() if room_id else None}


@app.post("/api/v1/dev/cache/force-miss/{room_id}")
async def force_cache_miss(room_id: str, x_dsm_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_dev_panel_access(x_dsm_token)
    store.force_miss(room_id)
    return {"roomId": room_id.upper(), "nextRead": "forced_miss"}


@app.post("/api/v1/rooms/{room_id}/players", status_code=201)
async def join_room(room_id: str, request: JoinRoomRequest) -> dict[str, Any]:
    room, player_id = await game_service.join_room(room_id, request.player_name)
    await emit_room_event("room.player_joined", room, {"playerId": player_id})
    return {"data": room, "playerId": player_id}


@app.post("/api/v1/rooms/{room_id}/players/{player_id}/leave")
async def leave_room(room_id: str, player_id: str) -> dict[str, Any]:
    room = await game_service.leave_room(room_id, player_id)
    await emit_room_event("room.player_left", room, {"playerId": player_id})
    return {"data": room}


@app.patch("/api/v1/rooms/{room_id}")
async def update_room(room_id: str, request: UpdateRoomRequest) -> dict[str, Any]:
    room = await game_service.update_room(room_id, request)
    await emit_room_event("room.updated", room)
    return {"data": room}


@app.post("/api/v1/rooms/{room_id}/rounds", status_code=201)
async def start_round(room_id: str, request: StartRoundRequest) -> dict[str, Any]:
    room = await game_service.start_round(room_id, request.player_id)
    await emit_room_event("room.round_started", room)
    return {"data": room}


@app.post("/api/v1/rooms/{room_id}/answers")
async def submit_answers(room_id: str, request: SubmitAnswersRequest) -> dict[str, Any]:
    room = await game_service.submit_answers(room_id, request.player_id, request.answers)
    await rabbit.publish("room.answers_submitted", {"roomId": room["id"], "playerId": request.player_id})
    return {"data": room}


@app.post("/api/v1/rooms/{room_id}/stop")
async def stop_round(room_id: str, request: StopRoundRequest) -> dict[str, Any]:
    room = await game_service.stop_round(room_id, request.player_id, request.answers, request.force)
    await emit_room_event("room.stopped", room)
    return {"data": room}


@app.post("/api/v1/rooms/{room_id}/votes")
async def vote_answer(room_id: str, request: VoteRequest) -> dict[str, Any]:
    room = await game_service.vote_answer(
        room_id,
        request.voter_id,
        request.target_player_id,
        request.category,
        request.valid,
    )
    await emit_room_event("room.answer_voted", room)
    return {"data": room}


@app.post("/api/v1/rooms/{room_id}/review/next")
async def advance_review_category(room_id: str, request: AdvanceReviewRequest) -> dict[str, Any]:
    room = await game_service.advance_review_category(room_id, request.player_id, request.review_category_index)
    await emit_room_event("room.review_advanced", room, {"playerId": request.player_id})
    return {"data": room}


@app.post("/api/v1/rooms/{room_id}/chat")
async def send_chat_message(room_id: str, request: ChatMessageRequest) -> dict[str, Any]:
    room = await game_service.add_chat_message(room_id, request.player_id, request.message)
    await emit_room_event("room.chat_message", room, {"playerId": request.player_id})
    return {"data": room}


@app.post("/api/v1/rooms/{room_id}/finish")
async def finish_round(room_id: str, request: StartRoundRequest) -> dict[str, Any]:
    room = await game_service.finish_round(room_id, request.player_id)
    await emit_room_event("room.round_finished", room)
    return {"data": room}


@app.websocket("/ws/rooms/{room_id}")
async def room_socket(room_id: str, websocket: WebSocket, player_id: str | None = None) -> None:
    normalized_room_id = room_id.upper()
    await manager.connect(normalized_room_id, websocket, player_id)
    try:
        room = await game_service.require_room(normalized_room_id)
        await websocket.send_json({"type": "room.snapshot", "data": with_presence(room)})
        await manager.broadcast(normalized_room_id, {"type": "room.presence", "data": with_presence(room)})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(normalized_room_id, websocket)
        try:
            room = await game_service.require_room(normalized_room_id)
            await manager.broadcast(normalized_room_id, {"type": "room.presence", "data": with_presence(room)})
        except HTTPException:
            return


async def emit_room_event(event_type: str, room: dict[str, Any], extra: dict[str, Any] | None = None) -> None:
    payload = {"roomId": room["id"], "room": room}
    if extra:
        payload.update(extra)

    await rabbit.publish(event_type, payload)
    await manager.broadcast(room["id"], {"type": event_type, "data": with_presence(room), **(extra or {})})


def with_presence(room: dict[str, Any]) -> dict[str, Any]:
    enriched_room = dict(room)
    presence = {player_id: "offline" for player_id in room.get("players", {})}
    presence.update(manager.presence(room["id"]))
    enriched_room["presence"] = presence
    return enriched_room


def require_dev_panel_access(token: str | None) -> None:
    if not settings.dsm_panel_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Painel DSM desabilitado.")
    if settings.dsm_debug_token and token != settings.dsm_debug_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Token DSM invalido.")
