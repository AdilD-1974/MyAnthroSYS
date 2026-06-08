import time
import logging
from fastapi import Request

logger = logging.getLogger("personahub")


async def log_requests(request: Request, call_next):
    """Middleware : log chaque requête avec durée et statut."""
    start = time.time()
    response = await call_next(request)
    duration = round((time.time() - start) * 1000)
    logger.info(
        f"{request.method} {request.url.path} → {response.status_code} ({duration}ms)"
    )
    return response
