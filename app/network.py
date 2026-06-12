from __future__ import annotations

import io
import socket
from dataclasses import dataclass
from urllib.parse import urlencode

import qrcode
from fastapi import Request
from PIL import Image
from qrcode.constants import ERROR_CORRECT_M

QR_SIZE = 220
QR_FOREGROUND = "#FFFFFF"
QR_BACKGROUND = "#052268"


@dataclass(frozen=True)
class NetworkInfo:
    ipv4: str | None
    port: int
    base_url: str


def get_primary_local_ipv4() -> str | None:
    """Retorna o IPv4 da interface usada para saída na rede local."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass

    return _get_hostname_ipv4()


def _get_hostname_ipv4() -> str | None:
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, family=socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return None


def resolve_server_port(request: Request) -> int:
    forwarded_port = request.headers.get("x-forwarded-port", "").strip()
    if forwarded_port.isdigit():
        return int(forwarded_port)

    if request.url.port is not None:
        return request.url.port

    return 443 if request.url.scheme == "https" else 80


def build_network_info(request: Request) -> NetworkInfo:
    ipv4 = get_primary_local_ipv4()
    port = resolve_server_port(request)

    if ipv4:
        base_url = f"http://{ipv4}:{port}"
    else:
        base_url = str(request.base_url).rstrip("/")

    return NetworkInfo(ipv4=ipv4, port=port, base_url=base_url)


def build_join_url(info: NetworkInfo, room_id: str | None = None) -> str:
    if room_id:
        normalized = room_id.strip().upper()
        if normalized:
            return f"{info.base_url}/?{urlencode({'room': normalized})}"

    return f"{info.base_url}/"


def generate_qr_code_png(url: str, size: int = QR_SIZE) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    image = qr.make_image(fill_color=QR_FOREGROUND, back_color=QR_BACKGROUND).convert("RGB")
    image = image.resize((size, size), Image.Resampling.NEAREST)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
