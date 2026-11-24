import os
from contextlib import contextmanager

from redis import Redis
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

engine = create_engine(os.environ['DATABASE_URL'], pool_pre_ping=True, isolation_level='READ COMMITTED')
Session = sessionmaker(bind=engine, expire_on_commit=False)
redis = Redis.from_url(os.environ['REDIS_URL'], socket_timeout=5)
QUEUE = 'tea:grade-review'


class Base(DeclarativeBase):
    pass


@contextmanager
def transaction():
    with Session.begin() as session:
        yield session


def get_db():
    with Session() as session:
        yield session
