import copy
import json
import logging
import time
from collections import deque
from typing import Any

from redis.asyncio import Redis

from app.config import settings

logger = logging.getLogger(__name__)


class RedisStore:
    def __init__(self, redis: Redis | None = None) -> None:
        self.redis = redis or Redis.from_url(settings.redis_url, decode_responses=True)
        self.cache_enabled = settings.cache_enabled
        self.cache_ttl = settings.cache_ttl
        self.cache_prefix = settings.cache_prefix.rstrip(":") or "stop"
        self.fallback_enabled = settings.cache_fallback_enabled
        self._origin_rooms: dict[str, dict[str, Any]] = {}
        self._force_miss_rooms: set[str] = set()
        self._operations: deque[dict[str, Any]] = deque(maxlen=80)
        self._stats = {
            "hits": 0,
            "misses": 0,
            "errors": 0,
            "fallbacks": 0,
            "writes": 0,
            "clears": 0,
        }
        self._last_status = "unknown"
        self._last_error: str | None = None

    async def get_room(self, room_id: str) -> dict[str, Any] | None:
        normalized_room_id = room_id.upper()
        operation = self._new_operation("get_room", normalized_room_id)
        cache_started = time.perf_counter()
        force_miss = normalized_room_id in self._force_miss_rooms

        if force_miss:
            self._force_miss_rooms.discard(normalized_room_id)
            self._stats["misses"] += 1
            operation["cacheStatus"] = "forced_miss"
        elif self.cache_enabled:
            try:
                raw_room = await self.redis.get(self._room_key(normalized_room_id))
                operation["cacheMs"] = self._elapsed_ms(cache_started)
                self._last_status = "online"
                self._last_error = None
                if raw_room is not None:
                    self._stats["hits"] += 1
                    operation["cacheStatus"] = "hit"
                    self._finish_operation(operation, "hit")
                    return json.loads(raw_room)
                self._stats["misses"] += 1
                operation["cacheStatus"] = "miss"
            except Exception as exc:
                operation["cacheMs"] = self._elapsed_ms(cache_started)
                operation["cacheStatus"] = "error"
                self._record_error(exc)
        else:
            operation["cacheStatus"] = "disabled"

        origin_started = time.perf_counter()
        room = self._read_origin(normalized_room_id)
        operation["originMs"] = self._elapsed_ms(origin_started)

        if room is not None and self.cache_enabled:
            await self._write_cache(room, operation)

        self._finish_operation(operation, "miss" if room is not None else "not_found")
        return room

    async def save_room(self, room: dict[str, Any]) -> None:
        normalized_room_id = room["id"].upper()
        room["id"] = normalized_room_id
        operation = self._new_operation("save_room", normalized_room_id)
        self._origin_rooms[normalized_room_id] = copy.deepcopy(room)
        self._stats["writes"] += 1
        if self.cache_enabled:
            await self._write_cache(room, operation)
        else:
            operation["cacheStatus"] = "disabled"
        self._finish_operation(operation, "written")

    async def delete_room(self, room_id: str) -> None:
        normalized_room_id = room_id.upper()
        operation = self._new_operation("delete_room", normalized_room_id)
        self._origin_rooms.pop(normalized_room_id, None)
        try:
            await self.redis.delete(self._room_key(normalized_room_id))
            self._last_status = "online"
            operation["cacheStatus"] = "cleared"
            self._stats["clears"] += 1
        except Exception as exc:
            operation["cacheStatus"] = "error"
            self._record_error(exc)
        self._finish_operation(operation, "cleared")

    async def clear_cache(self, room_id: str | None = None) -> int:
        operation = self._new_operation("clear_cache", room_id.upper() if room_id else "*")
        try:
            if room_id:
                deleted = await self.redis.delete(self._room_key(room_id.upper()))
            else:
                keys = await self.redis.keys(f"{self.cache_prefix}:room:*")
                deleted = await self.redis.delete(*keys) if keys else 0
            operation["cacheStatus"] = "cleared"
            self._stats["clears"] += int(deleted)
            self._last_status = "online"
            self._finish_operation(operation, "cleared")
            return int(deleted)
        except Exception as exc:
            operation["cacheStatus"] = "error"
            self._record_error(exc)
            self._finish_operation(operation, "error")
            return 0

    def force_miss(self, room_id: str) -> None:
        normalized_room_id = room_id.upper()
        self._force_miss_rooms.add(normalized_room_id)
        operation = self._new_operation("force_miss", normalized_room_id)
        operation["cacheStatus"] = "scheduled"
        self._finish_operation(operation, "scheduled")

    async def diagnostics(self) -> dict[str, Any]:
        ping_started = time.perf_counter()
        redis_status = "disabled"
        redis_latency_ms: float | None = None
        if self.cache_enabled:
            try:
                await self.redis.ping()
                redis_latency_ms = self._elapsed_ms(ping_started)
                redis_status = "online"
                self._last_status = "online"
                self._last_error = None
            except Exception as exc:
                redis_latency_ms = self._elapsed_ms(ping_started)
                redis_status = "offline"
                self._record_error(exc)

        last_operation = self._operations[-1] if self._operations else None
        return {
            "cache": {
                "enabled": self.cache_enabled,
                "ttl": self.cache_ttl,
                "prefix": self.cache_prefix,
                "fallbackEnabled": self.fallback_enabled,
                "originRooms": len(self._origin_rooms),
            },
            "redis": {
                "status": redis_status,
                "latencyMs": redis_latency_ms,
                "lastStatus": self._last_status,
                "lastError": self._last_error,
            },
            "dsm": {
                "status": self._dsm_status(redis_status),
                "lastResult": last_operation["result"] if last_operation else "none",
                "lastCacheStatus": last_operation["cacheStatus"] if last_operation else "none",
                "lastUpdatedAt": last_operation["finishedAt"] if last_operation else None,
            },
            "stats": dict(self._stats),
            "operations": list(reversed(self._operations)),
        }

    async def close(self) -> None:
        await self.redis.aclose()

    def _read_origin(self, room_id: str) -> dict[str, Any] | None:
        if not self.fallback_enabled:
            return None
        room = self._origin_rooms.get(room_id)
        if room is None:
            return None
        self._stats["fallbacks"] += 1
        return copy.deepcopy(room)

    async def _write_cache(self, room: dict[str, Any], operation: dict[str, Any]) -> None:
        cache_started = time.perf_counter()
        try:
            await self.redis.set(
                self._room_key(room["id"]),
                json.dumps(room, ensure_ascii=False),
                ex=self.cache_ttl,
            )
            operation["cacheMs"] = self._elapsed_ms(cache_started)
            operation["cacheStatus"] = operation.get("cacheStatus") or "write"
            self._last_status = "online"
            self._last_error = None
        except Exception as exc:
            operation["cacheMs"] = self._elapsed_ms(cache_started)
            operation["cacheStatus"] = "error"
            self._record_error(exc)

    def _record_error(self, exc: Exception) -> None:
        self._stats["errors"] += 1
        self._last_status = "offline"
        self._last_error = exc.__class__.__name__
        logger.warning("Redis indisponivel; seguindo com fallback quando possivel: %s", exc)

    def _new_operation(self, action: str, room_id: str) -> dict[str, Any]:
        return {
            "action": action,
            "roomId": room_id,
            "cacheStatus": "pending",
            "cacheMs": None,
            "originMs": None,
            "startedAt": int(time.time()),
            "finishedAt": None,
            "result": "pending",
        }

    def _finish_operation(self, operation: dict[str, Any], result: str) -> None:
        operation["result"] = result
        operation["finishedAt"] = int(time.time())
        self._operations.append(operation)

    def _dsm_status(self, redis_status: str) -> str:
        if self.cache_enabled and redis_status == "online":
            return "distributed_cache_active"
        if self.fallback_enabled:
            return "fallback_origin_active"
        return "unavailable"

    def _room_key(self, room_id: str) -> str:
        return f"{self.cache_prefix}:room:{room_id}"

    @staticmethod
    def _elapsed_ms(started_at: float) -> float:
        return round((time.perf_counter() - started_at) * 1000, 2)
