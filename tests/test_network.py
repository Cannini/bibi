from unittest.mock import MagicMock

from app.network import (
    build_join_url,
    build_network_info,
    generate_qr_code_png,
    get_primary_local_ipv4,
    resolve_server_port,
)
def test_get_primary_local_ipv4_skips_loopback(monkeypatch) -> None:
    class FakeSocket:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def connect(self, _address) -> None:
            return None

        def getsockname(self):
            return ("127.0.0.1", 0)

    monkeypatch.setattr("app.network.socket.socket", lambda *args, **kwargs: FakeSocket())
    monkeypatch.setattr("app.network._get_hostname_ipv4", lambda: "192.168.0.15")

    assert get_primary_local_ipv4() == "192.168.0.15"


def test_resolve_server_port_prefers_forwarded_header() -> None:
    request = MagicMock()
    request.headers = {"x-forwarded-port": "9000"}
    request.url.port = 8001
    request.url.scheme = "http"

    assert resolve_server_port(request) == 9000


def test_build_network_info_uses_local_ipv4(monkeypatch) -> None:
    monkeypatch.setattr("app.network.get_primary_local_ipv4", lambda: "192.168.1.10")

    request = MagicMock()
    request.headers = {}
    request.url.port = 8001
    request.url.scheme = "http"
    request.base_url = "http://127.0.0.1:8001/"

    info = build_network_info(request)

    assert info.ipv4 == "192.168.1.10"
    assert info.port == 8001
    assert info.base_url == "http://192.168.1.10:8001"
    assert build_join_url(info, "abc123") == "http://192.168.1.10:8001/?room=ABC123"


def test_build_network_info_fallback_without_ipv4(monkeypatch) -> None:
    monkeypatch.setattr("app.network.get_primary_local_ipv4", lambda: None)

    request = MagicMock()
    request.headers = {}
    request.url.port = 8001
    request.url.scheme = "http"
    request.base_url = "http://127.0.0.1:8001/"

    info = build_network_info(request)

    assert info.ipv4 is None
    assert info.base_url == "http://127.0.0.1:8001"


def test_generate_qr_code_png_returns_png_bytes() -> None:
    png = generate_qr_code_png("http://192.168.1.10:8001/")

    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(png) > 100
