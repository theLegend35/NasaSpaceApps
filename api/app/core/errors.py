"""ApiError: every failure the API returns has a code, a message and a retryable flag."""
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, code: str, message: str, *, status: int = 400, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable


def upstream_timeout(service: str) -> ApiError:
    """IRSA (or any archive) timed out: 503 with retryable: true, per the design doc."""
    return ApiError(
        "upstream_timeout",
        f"{service} did not answer in time. Try again in a minute.",
        status=503,
        retryable=True,
    )


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={"code": exc.code, "message": exc.message, "retryable": exc.retryable},
    )
