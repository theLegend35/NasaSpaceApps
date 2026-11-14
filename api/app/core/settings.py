from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_ROOT / ".env", extra="ignore")

    version: str = "0.1.0"
    # Comma-separated list of web origins allowed to call the API.
    allowed_origins: str = "http://localhost:3000"
    # Public base URL of this API, used to build PNG/FITS links in responses.
    public_base_url: str = "http://localhost:8000"

    cache_dir: Path = API_ROOT / ".cache"
    demo_pack_dir: Path = API_ROOT / "demo_pack"
    config_dir: Path = API_ROOT / "config"
    data_dir: Path = API_ROOT / "data"

    # Outbound calls: timeout per call, then 3 retries at 10/20/30 s (design doc §3).
    tap_timeout_s: float = 180.0
    http_timeout_s: float = 60.0
    retry_delays_s: tuple[float, ...] = (10.0, 20.0, 30.0)
    download_workers: int = 8

    irsa_base: str = "https://irsa.ipac.caltech.edu"
    gaia_tap: str = "https://gea.esac.esa.int/tap-server/tap/sync"
    sesame_url: str = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/S"

    # xAI: server side only. Never shipped to the browser.
    xai_api_key: str | None = None
    xai_model: str | None = None  # set XAI_MODEL to a current xAI chat model name
    xai_base_url: str = "https://api.x.ai/v1"

    # Supabase service access for candidates (API writes, browser reads under RLS).
    supabase_url: str | None = None
    supabase_service_key: str | None = None

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.cache_dir.mkdir(parents=True, exist_ok=True)
    return s
