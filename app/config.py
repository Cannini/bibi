from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Stop Game"
    redis_url: str = "redis://localhost:6379/0"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    rabbitmq_exchange: str = "stop.events"
    rabbitmq_queue: str = "stop.events.audit"
    cache_enabled: bool = True
    cache_ttl: int = 3600
    cache_prefix: str = "stop"
    cache_fallback_enabled: bool = True
    dsm_panel_enabled: bool = True
    dsm_debug_token: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
