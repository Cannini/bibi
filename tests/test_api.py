from typing import Any

from fastapi.testclient import TestClient

from app import main
from app.game import GameService


class MemoryStore:
    def __init__(self) -> None:
        self.rooms: dict[str, dict[str, Any]] = {}

    async def get_room(self, room_id: str) -> dict[str, Any] | None:
        return self.rooms.get(room_id)

    async def save_room(self, room: dict[str, Any]) -> None:
        self.rooms[room["id"]] = room


class FakeRabbit:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((event_type, payload))

    def diagnostics(self) -> dict[str, Any]:
        return {"status": "test", "events": []}


def make_client(monkeypatch) -> TestClient:
    monkeypatch.setattr(main, "game_service", GameService(MemoryStore()))
    monkeypatch.setattr(main, "rabbit", FakeRabbit())
    main.manager.active_connections.clear()
    main.manager.connection_players.clear()
    return TestClient(main.app)


def create_room(client: TestClient) -> dict[str, Any]:
    response = client.post(
        "/api/v1/rooms",
        json={
            "host_name": "Ana",
            "categories": ["Nome", "CEP", "Animal", "Comida", "Cor"],
            "letters": ["A", "B", "C"],
            "max_rounds": 6,
            "round_duration_seconds": 60,
        },
    )

    assert response.status_code == 201
    return response.json()


def test_create_room_accepts_min_max_rounds(monkeypatch) -> None:
    client = make_client(monkeypatch)

    response = client.post(
        "/api/v1/rooms",
        json={
            "host_name": "Ana",
            "categories": ["Nome", "CEP", "Animal", "Comida", "Cor"],
            "letters": ["A", "B", "C"],
            "max_rounds": 1,
            "round_duration_seconds": 60,
        },
    )

    assert response.status_code == 201
    assert response.json()["data"]["max_rounds"] == 1


def test_create_room_and_join_player(monkeypatch) -> None:
    client = make_client(monkeypatch)

    created = create_room(client)
    room_id = created["data"]["id"]

    joined = client.post(f"/api/v1/rooms/{room_id}/players", json={"player_name": "Beto"})

    assert joined.status_code == 201
    data = joined.json()["data"]
    assert data["id"] == room_id
    assert len(data["players"]) == 2
    assert "Beto" in data["players"].values()


def test_network_info_returns_local_url(monkeypatch) -> None:
    client = make_client(monkeypatch)
    monkeypatch.setattr("app.network.get_primary_local_ipv4", lambda: "192.168.1.42")

    response = client.get("/api/v1/network/info")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ipv4"] == "192.168.1.42"
    assert data["port"] == 80
    assert data["baseUrl"] == "http://192.168.1.42:80"


def test_network_qr_code_returns_png(monkeypatch) -> None:
    client = make_client(monkeypatch)
    monkeypatch.setattr("app.network.get_primary_local_ipv4", lambda: "10.0.0.5")

    response = client.get("/api/v1/network/qr-code", params={"room": "abc123"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_stop_endpoint_validates_manual_and_accepts_forced_stop(monkeypatch) -> None:
    client = make_client(monkeypatch)
    created = create_room(client)
    room_id = created["data"]["id"]
    player_id = created["playerId"]

    started = client.post(f"/api/v1/rooms/{room_id}/rounds", json={"player_id": player_id})
    assert started.status_code == 201

    manual_stop = client.post(
        f"/api/v1/rooms/{room_id}/stop",
        json={"player_id": player_id, "answers": {"Nome": "Ana"}, "force": False},
    )
    assert manual_stop.status_code == 400

    forced_stop = client.post(
        f"/api/v1/rooms/{room_id}/stop",
        json={"player_id": player_id, "answers": {"Nome": "Ana"}, "force": True},
    )
    data = forced_stop.json()["data"]

    assert forced_stop.status_code == 200
    assert data["status"] == "voting"
    assert data["stopped_by"] is None
