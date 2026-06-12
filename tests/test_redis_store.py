import json

import pytest

from app.redis_store import RedisStore


class FakeRedis:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.values: dict[str, str] = {}
        self.ttl_by_key: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        self._raise_if_needed()
        return self.values.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._raise_if_needed()
        self.values[key] = value
        if ex is not None:
            self.ttl_by_key[key] = ex

    async def delete(self, *keys: str) -> int:
        self._raise_if_needed()
        deleted = 0
        for key in keys:
            if key in self.values:
                deleted += 1
                del self.values[key]
        return deleted

    async def keys(self, pattern: str) -> list[str]:
        self._raise_if_needed()
        prefix = pattern.removesuffix("*")
        return [key for key in self.values if key.startswith(prefix)]

    async def ping(self) -> bool:
        self._raise_if_needed()
        return True

    async def aclose(self) -> None:
        return None

    def _raise_if_needed(self) -> None:
        if self.fail:
            raise ConnectionError("redis offline")


def make_store(redis: FakeRedis) -> RedisStore:
    store = RedisStore(redis=redis)
    store.cache_prefix = "test"
    store.cache_ttl = 30
    store.cache_enabled = True
    store.fallback_enabled = True
    return store


@pytest.mark.asyncio
async def test_get_room_reads_cache_first() -> None:
    redis = FakeRedis()
    redis.values["test:room:ABC123"] = json.dumps({"id": "ABC123", "players": {}})
    store = make_store(redis)

    room = await store.get_room("abc123")

    assert room == {"id": "ABC123", "players": {}}
    diagnostics = await store.diagnostics()
    assert diagnostics["stats"]["hits"] == 1
    assert diagnostics["dsm"]["lastCacheStatus"] == "hit"


@pytest.mark.asyncio
async def test_cache_miss_reads_origin_and_writes_cache_with_ttl() -> None:
    redis = FakeRedis()
    store = make_store(redis)
    await store.save_room({"id": "ABC123", "players": {"p1": "Ana"}})
    await store.clear_cache("ABC123")

    room = await store.get_room("ABC123")

    assert room["players"] == {"p1": "Ana"}
    assert json.loads(redis.values["test:room:ABC123"])["players"] == {"p1": "Ana"}
    assert redis.ttl_by_key["test:room:ABC123"] == 30
    diagnostics = await store.diagnostics()
    assert diagnostics["stats"]["misses"] == 1
    assert diagnostics["stats"]["fallbacks"] == 1


@pytest.mark.asyncio
async def test_redis_failure_falls_back_to_origin() -> None:
    redis = FakeRedis()
    store = make_store(redis)
    await store.save_room({"id": "ABC123", "players": {"p1": "Ana"}})
    redis.fail = True

    room = await store.get_room("ABC123")

    assert room["players"] == {"p1": "Ana"}
    diagnostics = await store.diagnostics()
    assert diagnostics["redis"]["status"] == "offline"
    assert diagnostics["stats"]["errors"] >= 1
    assert diagnostics["dsm"]["status"] == "fallback_origin_active"


@pytest.mark.asyncio
async def test_clear_cache_removes_room_key() -> None:
    redis = FakeRedis()
    store = make_store(redis)
    await store.save_room({"id": "ABC123", "players": {}})

    deleted = await store.clear_cache("ABC123")

    assert deleted == 1
    assert "test:room:ABC123" not in redis.values


@pytest.mark.asyncio
async def test_force_miss_skips_cache_once() -> None:
    redis = FakeRedis()
    store = make_store(redis)
    await store.save_room({"id": "ABC123", "players": {"p1": "Ana"}})
    redis.values["test:room:ABC123"] = json.dumps({"id": "ABC123", "players": {"stale": "Cache"}})

    store.force_miss("ABC123")
    room = await store.get_room("ABC123")

    assert room["players"] == {"p1": "Ana"}
    diagnostics = await store.diagnostics()
    assert diagnostics["dsm"]["lastCacheStatus"] == "forced_miss"
