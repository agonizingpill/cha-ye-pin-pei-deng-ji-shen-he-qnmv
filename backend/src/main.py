import logging
import os
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from scripts.seed_demo import seed
from .operations_evidence import router as operations_evidence
from .db import Base, engine, redis, transaction
from .routes import router
from .workflow import record

logger = logging.getLogger('uvicorn.error')


@asynccontextmanager
async def lifecycle(app):
    Base.metadata.create_all(engine)
    if os.getenv('SEED_DEMO', 'true').lower() == 'true':
        try:
            seed()
        except Exception:
            logger.exception('Demo seed failed')
    yield


app = FastAPI(title='岩册 · 茶叶拼配等级审核', lifespan=lifecycle)
app.include_router(operations_evidence)
app.include_router(router)


@app.get('/health')
def health():
    with engine.connect() as conn:
        conn.exec_driver_sql('SELECT 1')
    redis.ping()
    return {'status': 'ok'}


@app.middleware('http')
async def response_headers(request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.middleware('http')
async def request_log(request, call_next):
    start = time.monotonic()
    request_id = uuid4().hex
    response = await call_next(request)
    response.headers['X-Request-ID'] = request_id
    if request.url.path != '/health':
        logger.info('%s %s %s %s %.0fms', request_id, request.method, request.url.path,
                    response.status_code, (time.monotonic() - start) * 1000)
    return response


def reject(request, status, detail, headers=None):
    username = getattr(request.state, 'actor', None)
    if username and request.method in {'POST', 'PUT'}:
        try:
            with transaction() as db:
                record(db, username, 'action.denied', request.url.path[:190], detail)
        except SQLAlchemyError:
            logger.exception('Could not record rejected operation')
    return JSONResponse({'detail': detail}, status_code=status, headers=headers)


@app.exception_handler(HTTPException)
def http_error(request: Request, exc: HTTPException):
    return reject(request, exc.status_code, exc.detail, exc.headers)


@app.exception_handler(IntegrityError)
def conflict(request: Request, exc: IntegrityError):
    return reject(request, 409, '编号、封签或关联记录已存在，请刷新并核对')


@app.exception_handler(RequestValidationError)
def invalid(request: Request, exc: RequestValidationError):
    detail = '；'.join(f'{" / ".join(map(str, error["loc"][1:]))}：{error["msg"]}' for error in exc.errors())
    return reject(request, 422, detail)
