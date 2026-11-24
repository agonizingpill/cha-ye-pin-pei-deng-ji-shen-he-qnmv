import logging
from pathlib import Path

from redis import RedisError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .constants import RecalcState as Recalc, ReviewState as State
from .db import QUEUE, RECALC_QUEUE, redis, transaction
from .grade_model import compare, digest, run
from .models import GradeReview, RecalcRun
from .workflow import record, wake

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)
heartbeat = Path('/work/worker.touch')


def queue_recalc(db, review):
    """模型直判的审核在签发前登记一张独立复算单；已存在时沿用原单，不新增。"""
    recalc = db.scalar(select(RecalcRun).filter_by(review_id=review.id))
    if recalc is None:
        recalc = RecalcRun(review_id=review.id, snapshot=review.snapshot, digest=review.digest)
        db.add(recalc)
    recalc.state = Recalc.QUEUED
    recalc.baseline = review.result
    recalc.result = None
    recalc.mismatches = None
    recalc.failure = None
    db.flush()
    return recalc.id


def consume(review_id=None):
    recalc_id = None
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
            if review.state == State.VERIFY:
                recalc_id = queue_recalc(db, review)
            detail = f'{review.digest} · {review.state} · {review.result["confidence"]:.6f}'
        except Exception as exc:
            logger.exception('Grade review %s failed', review.id)
            review.state = State.FAILED
            review.failure = f'{type(exc).__name__}: {exc}'[:350]
            detail = review.failure
        record(db, 'worker', 'grade.compute', review.id, detail)
        logger.info('review=%s state=%s attempts=%s', review.id, review.state, review.attempts)
    if recalc_id is not None:
        wake(RECALC_QUEUE, recalc_id)


def revoke_verify(db, recalc):
    """复算对不上：撤回初审、转盲复评，首算在复算单 baseline 留底。"""
    review = db.get(GradeReview, recalc.review_id, with_for_update=True)
    if review is None or review.state not in (State.VERIFY, State.SIGNOFF):
        return
    review.verified_by = None
    review.final_grade = None
    review.state = State.REPANEL
    record(db, 'worker', 'grade.verify.revoke', review.id,
           f'复算对不上（{",".join(recalc.mismatches)}），撤回初审转盲复评，首算留底')


def consume_recalc(recalc_id=None):
    with transaction() as db:
        query = select(RecalcRun).where(RecalcRun.state == Recalc.QUEUED)
        if recalc_id is not None:
            query = query.where(RecalcRun.id == recalc_id)
        recalc = db.scalar(query.order_by(RecalcRun.id).limit(1).with_for_update(skip_locked=True))
        if recalc is None:
            return
        recalc.attempts += 1
        try:
            if digest(recalc.snapshot) != recalc.digest:
                raise ValueError('冻结快照摘要不匹配')
            result = run(recalc.snapshot)
            if result['model'] != recalc.baseline['model']:
                raise ValueError(f'原模型 {recalc.baseline["model"]} 取不到，当前环境为 {result["model"]}')
            recalc.result = result
            recalc.mismatches = compare(recalc.baseline, result)
            if recalc.mismatches:
                recalc.state = Recalc.MISMATCHED
                revoke_verify(db, recalc)
                detail = f'{recalc.digest} · mismatched · {",".join(recalc.mismatches)}'
            else:
                recalc.state = Recalc.MATCHED
                detail = f'{recalc.digest} · matched · {result["confidence"]:.6f}'
        except Exception as exc:
            logger.exception('Grade recalc %s failed', recalc.id)
            recalc.state = Recalc.FAILED
            recalc.failure = f'{type(exc).__name__}: {exc}'[:350]
            detail = recalc.failure
        record(db, 'worker', 'grade.recalc', recalc.id, detail)
        logger.info('recalc=%s state=%s attempts=%s', recalc.id, recalc.state, recalc.attempts)


def main():
    import time

    while True:
        try:
            try:
                message = redis.blpop((QUEUE, RECALC_QUEUE), timeout=2)
            except RedisError:
                message = None
                time.sleep(2)
            if message and message[1].isdigit():
                if message[0].decode() == RECALC_QUEUE:
                    consume_recalc(int(message[1]))
                else:
                    consume(int(message[1]))
            consume()
            consume_recalc()
            heartbeat.touch()
        except SQLAlchemyError:
            logger.exception('Database unavailable, retrying queue')
            time.sleep(2)


if __name__ == '__main__':
    main()
