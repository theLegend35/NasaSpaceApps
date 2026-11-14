"""SolaraX API: all science and AI calls. The browser never talks to IRSA, Gaia or xAI directly.

AI-assisted: Claude Code (see README, AI disclosure).
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.errors import ApiError, api_error_handler
from .core.settings import get_settings
from .routers.v1 import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="SolaraX API", version=get_settings().version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.add_exception_handler(ApiError, api_error_handler)
app.include_router(router)
