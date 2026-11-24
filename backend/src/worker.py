import logging
from pathlib import Path

from redis import RedisError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .constants import ReviewState as State
from .db import QUEUE, redis, transaction
from .grade_model import digest, run
from .models import GradeReview
from .workflow import record

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)
heartbeat = Path('/work/worker.touch')


def consume(review_id=None):
    with transaction() as db:
        query = select(GradeReview).where(GradeReview.state == State.QUEUED)
        if review_id is not None:
            query = query.where(GradeReview.id == review_id)
        review = db.scalar(query.order_by(GradeReview.id).limit(1).with_for_update(skip_locked=True))
        if review is None:
            return
        review.attempts += 1
        try:
            if digest(review.snapshot) != review.digest:
                raise ValueError('冻结快照摘要不匹配')
            review.result = run(review.snapshot)
            review.state = State.REPANEL if review.result['needs_repanel'] else State.VERIFY
            detail = f'{review.digest} · {review.state} · {review.result["confidence"]:.6f}'
        except Exception as exc:
            logger.exception('Grade review %s failed', review.id)
            review.state = State.FAILED
            review.failure = f'{type(exc).__name__}: {exc}'[:350]
            detail = review.failure
        record(db, 'worker', 'grade.compute', review.id, detail)
        logger.info('review=%s state=%s attempts=%s', review.id, review.state, review.attempts)


def main():
    import time

    while True:
        try:
            try:
                message = redis.blpop(QUEUE, timeout=2)
            except RedisError:
                message = None
                time.sleep(2)
            if message and message[1].isdigit():
                consume(int(message[1]))
            consume()
            heartbeat.touch()
        except SQLAlchemyError:
            logger.exception('Database unavailable, retrying queue')
            time.sleep(2)


if __name__ == '__main__':
    main()
