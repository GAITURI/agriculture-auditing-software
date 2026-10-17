import contextvars
import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app")
correlation_id = contextvars.ContextVar("correlation_id", default=None)


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details


def _body(code, message, details=None):
    return {"error": {"code": code, "message": message, "details": details, "correlation_id": correlation_id.get()}}


def install(app: FastAPI):
    @app.middleware("http")
    async def corr(request: Request, call_next):
        cid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = correlation_id.set(cid)
        try:
            resp = await call_next(request)
        finally:
            correlation_id.reset(token)
        resp.headers["x-request-id"] = cid
        return resp

    @app.exception_handler(AppError)
    async def _app(_, e: AppError):
        return JSONResponse(_body(e.code, e.message, e.details), e.status)

    @app.exception_handler(RequestValidationError)
    async def _val(_, e: RequestValidationError):
        d = [{"field": ".".join(map(str, x["loc"][1:])), "message": x["msg"].replace("Value error, ", "")} for x in e.errors()]
        return JSONResponse(_body("validation_error", "; ".join(f"{x['field']}: {x['message']}" for x in d), d), 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_, e: StarletteHTTPException):
        return JSONResponse(_body(f"http_{e.status_code}", str(e.detail)), e.status_code)

    @app.exception_handler(Exception)
    async def _any(_, e: Exception):  # never leak SQL, stack traces or secrets
        log.exception("unhandled error cid=%s", correlation_id.get())
        return JSONResponse(_body("internal_error", "Unexpected server error. Quote the correlation id to support."), 500)
