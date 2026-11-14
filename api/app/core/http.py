"""Outbound HTTP with a timeout on every call and 3 retries at 10/20/30 s.

Nothing in here raises raw httpx errors to a route: failures become ApiError.
"""
from __future__ import annotations

import csv
import io
import logging
import time
from typing import Any

import httpx

from .errors import ApiError, upstream_timeout
from .settings import get_settings

log = logging.getLogger("solarax.http")


def request_with_retries(
    method: str,
    url: str,
    *,
    service: str,
    timeout: float | None = None,
    delays: tuple[float, ...] | None = None,
    **kwargs: Any,
) -> httpx.Response:
    s = get_settings()
    timeout = timeout or s.http_timeout_s
    delays = s.retry_delays_s if delays is None else delays
    last: Exception | None = None
    for attempt in range(len(delays) + 1):
        try:
            r = httpx.request(method, url, timeout=timeout, follow_redirects=True, **kwargs)
            if r.status_code >= 500:
                raise httpx.HTTPStatusError(f"{r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r
        except httpx.TimeoutException as e:
            last = e
        except httpx.HTTPStatusError as e:
            # 4xx means our request is wrong; retrying won't help.
            if e.response is not None and e.response.status_code < 500:
                raise ApiError(
                    "upstream_rejected",
                    f"{service} rejected the request ({e.response.status_code}).",
                    status=502,
                ) from e
            last = e
        except httpx.HTTPError as e:
            if "CERTIFICATE_VERIFY_FAILED" in str(e):
                # Not transient: retrying won't fix the trust store.
                raise ApiError("tls_error", f"Couldn't verify {service}'s TLS certificate.", status=502) from e
            last = e
        if attempt < len(delays):
            log.warning("%s attempt %d failed (%s); retrying in %ss", service, attempt + 1, last, delays[attempt])
            time.sleep(delays[attempt])
    if isinstance(last, httpx.TimeoutException):
        raise upstream_timeout(service)
    raise ApiError("upstream_error", f"{service} is not answering right now.", status=503, retryable=True)


def tap_query(endpoint: str, adql: str, *, service: str, timeout: float | None = None,
              async_fallback: bool = True) -> list[dict[str, str]]:
    """TAP query returning CSV rows as dicts (all values are strings).

    Tries sync first (one quick attempt). Slow archives and proxies that cut long
    connections get the async route: submit a job, poll it, fetch the result.
    """
    s = get_settings()
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql}
    if not (async_fallback and endpoint.endswith("/sync")):
        r = request_with_retries("POST", endpoint, service=service, timeout=timeout or s.tap_timeout_s, data=data)
        return list(csv.DictReader(io.StringIO(r.text)))
    try:
        r = request_with_retries("POST", endpoint, service=service, timeout=min(60.0, timeout or 60.0), delays=(), data=data)
        return list(csv.DictReader(io.StringIO(r.text)))
    except ApiError as e:
        if not e.retryable:
            raise
        log.info("%s sync query failed (%s); switching to async TAP", service, e.message)
    return _tap_async(endpoint[: -len("/sync")] + "/async", data, service=service,
                      total_s=max(timeout or s.tap_timeout_s, 300.0))


def _tap_async(endpoint: str, data: dict, *, service: str, total_s: float) -> list[dict[str, str]]:
    r = request_with_retries("POST", endpoint, service=service, timeout=60, data={**data, "PHASE": "RUN"})
    job = str(r.url)  # the 303 redirect lands on the job URL
    if job.rstrip("/").endswith("/async"):
        loc = r.headers.get("location")
        if not loc:
            raise ApiError("upstream_error", f"{service} didn't create a query job.", status=503, retryable=True)
        job = loc
    t0, wait = time.time(), 2.0
    while time.time() - t0 < total_s:
        phase = request_with_retries("GET", f"{job}/phase", service=service, timeout=30).text.strip().upper()
        if phase == "COMPLETED":
            res = request_with_retries("GET", f"{job}/results/result", service=service, timeout=120)
            return list(csv.DictReader(io.StringIO(res.text)))
        if phase in ("ERROR", "ABORTED"):
            raise ApiError("query_failed", f"{service} couldn't run the query ({phase}).", status=502)
        time.sleep(wait)
        wait = min(wait * 1.5, 15.0)
    raise upstream_timeout(service)


def fnum(v: str | None) -> float | None:
    """Parse a TAP CSV cell to float; empty or non-numeric becomes None."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None
