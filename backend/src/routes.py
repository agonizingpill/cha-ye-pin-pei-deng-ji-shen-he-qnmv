from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import present, schemas as s, workflow as flow
from .auth import actor, issue, matches, permits
from .constants import RecalcState, ReviewState as State, Role
from .db import QUEUE, RECALC_QUEUE, get_db
from .models import Audit, BlendRecipe, GradeReview, RecalcRun, RetainedSample, SensoryPanel, TeaLot, ThresholdPolicy, User

router = APIRouter()
reader = Depends(actor)
operator = Depends(permits(Role.OPERATOR))
supervisor = Depends(permits(Role.SUPERVISOR))
sealer = Depends(permits(Role.OPERATOR, Role.SUPERVISOR))
database = Depends(get_db)


@router.post('/session')
def login(data: s.Credentials, db: Session = database):
    user = db.scalar(select(User).where(User.username == data.username))
    if user is None or not matches(data.password, user.password_hash):
        raise HTTPException(401, '工号或口令不正确')
    return {'token': issue(user), 'user': present.user_out(user)}


@router.get('/lots')
def lots(user: User = reader, db: Session = database):
    return [present.lot_out(row, db) for row in db.scalars(select(TeaLot).order_by(TeaLot.id.desc()))]


@router.post('/lots', status_code=201)
def create_lot(data: s.LotInput, user: User = operator, db: Session = database):
    row = TeaLot(**data.model_dump(), registered_by=user.id)
    db.add(row)
    db.flush()
    flow.record(db, user, 'lot.receive', row.code, f'{row.kilograms} kg · {row.origin}')
    db.commit()
    return present.lot_out(row, db)


@router.post('/lots/{key}/panels', status_code=201)
def panel_lot(key: int, data: s.PanelInput, user: User = operator, db: Session = database):
    lot = flow.require(db, TeaLot, key, lock=True)
    row = SensoryPanel(lot_id=lot.id, author_id=user.id, **data.model_dump())
    db.add(row)
    flow.record(db, user, 'panel.record', lot.code, data.note)
    db.commit()
    return present.panel_out(row, db)


@router.post('/lots/{key}/sample', status_code=201)
def retain_lot(key: int, data: s.SampleInput, user: User = sealer, db: Session = database):
    lot = flow.require(db, TeaLot, key, lock=True)
    if flow.sample_for(db, lot_id=key):
        raise HTTPException(409, '此原料已有封签，不能重复登记')
    row = RetainedSample(lot_id=key, sealed_by=user.id, **data.model_dump())
    db.add(row)
    flow.record(db, user, 'sample.lot', lot.code, f'{row.seal} · {row.cabinet} · {row.grams} g')
    db.commit()
    return present.sample_out(row)


@router.get('/blends')
def blends(user: User = reader, db: Session = database):
    return [present.recipe_out(row, db) for row in db.scalars(select(BlendRecipe).order_by(BlendRecipe.id.desc()))]


@router.post('/blends', status_code=201)
def create_blend(data: s.RecipeInput, user: User = operator, db: Session = database):
    row = BlendRecipe(code=data.code, name=data.name, note=data.note, author_id=user.id)
    flow.replace_shares(db, row, data)
    db.add(row)
    flow.record(db, user, 'blend.draft', row.code, row.note)
    db.commit()
    return present.recipe_out(row, db)


@router.put('/blends/{key}')
def change_blend(key: int, data: s.RecipeInput, user: User = operator, db: Session = database):
    row = flow.require(db, BlendRecipe, key, lock=True)
    if row.author_id != user.id:
        raise HTTPException(403, '只有配方作者可以修订草稿')
    if row.reviews:
        raise HTTPException(409, '已送审的配方已经冻结，请另立配方')
    if row.code != data.code:
        raise HTTPException(409, '配方编号保持固定')
    flow.replace_shares(db, row, data)
    row.name, row.note = data.name, data.note
    row.revision += 1
    flow.record(db, user, 'blend.revise', row.code, f'修订 v{row.revision} · {data.note}')
    db.commit()
    return present.recipe_out(row, db)


@router.post('/blends/{key}/review', status_code=202)
def submit(key: int, user: User = operator, db: Session = database):
    row = flow.require(db, BlendRecipe, key, lock=True)
    if row.author_id != user.id:
        raise HTTPException(403, '只有配方作者可以送审')
    if row.reviews:
        raise HTTPException(409, '该配方已经送审')
    review = flow.freeze(db, row)
    db.add(review)
    flow.record(db, user, 'grade.queue', row.code, review.digest)
    db.commit()
    flow.wake(QUEUE, review.id)
    return present.review_out(review, db)


@router.get('/reviews/{key}')
def find_review(key: int, user: User = reader, db: Session = database):
    return present.review_out(flow.require(db, GradeReview, key), db)


@router.post('/reviews/{key}/retry', status_code=202)
def retry(key: int, user: User = supervisor, db: Session = database):
    row = flow.require(db, GradeReview, key, lock=True)
    flow.expect(row, State.FAILED)
    row.state, row.failure = State.QUEUED, None
    flow.record(db, user, 'grade.retry', key, row.digest)
    db.commit()
    flow.wake(QUEUE, key)
    return present.review_out(row, db)


@router.post('/reviews/{key}/recalc/retry', status_code=202)
def retry_recalc(key: int, user: User = supervisor, db: Session = database):
    review = flow.require(db, GradeReview, key)
    recalc = db.scalar(select(RecalcRun).filter_by(review_id=review.id).with_for_update())
    if recalc is None:
        raise HTTPException(404, '该审核没有独立复算单')
    if recalc.state != RecalcState.FAILED:
        raise HTTPException(409, f'复算状态 {recalc.state} 不支持重试')
    recalc.state, recalc.failure = RecalcState.QUEUED, None
    recalc.result, recalc.mismatches = None, None
    flow.record(db, user, 'grade.recalc.retry', key, recalc.digest)
    db.commit()
    flow.wake(RECALC_QUEUE, recalc.id)
    return present.review_out(review, db)


@router.post('/reviews/{key}/repanel')
def repanel(key: int, data: s.RepanelInput, user: User = operator, db: Session = database):
    row = flow.require(db, GradeReview, key, lock=True)
    flow.repanel(db, row, user, data)
    db.commit()
    return present.review_out(row, db)


@router.post('/reviews/{key}/verify')
def verify(key: int, data: s.Decision, user: User = operator, db: Session = database):
    row = flow.require(db, GradeReview, key, lock=True)
    flow.verify(db, row, user, data.note)
    db.commit()
    return present.review_out(row, db)


@router.post('/reviews/{key}/signoff')
def signoff(key: int, data: s.Decision, user: User = supervisor, db: Session = database):
    row = flow.require(db, GradeReview, key, lock=True)
    flow.approve(db, row, user, data.note)
    db.commit()
    return present.review_out(row, db)


@router.post('/reviews/{key}/sample', status_code=201)
def retain_blend(key: int, data: s.SampleInput, user: User = sealer, db: Session = database):
    review = flow.require(db, GradeReview, key, lock=True)
    flow.expect(review, State.APPROVED)
    row = RetainedSample(review_id=key, sealed_by=user.id, **data.model_dump())
    review.state = State.SEALED
    db.add(row)
    flow.record(db, user, 'sample.blend', key, f'{row.seal} · {row.cabinet} · {row.grams} g')
    db.commit()
    return present.sample_out(row)


@router.get('/thresholds')
def thresholds(user: User = reader, db: Session = database):
    return [present.policy_out(row, db) for row in db.scalars(select(ThresholdPolicy).order_by(ThresholdPolicy.id.desc()))]


@router.post('/thresholds', status_code=201)
def set_threshold(data: s.ThresholdInput, user: User = supervisor, db: Session = database):
    row = ThresholdPolicy(floor=data.floor, reason=data.note, author_id=user.id)
    db.add(row)
    db.flush()
    flow.record(db, user, 'threshold.publish', row.id, f'{row.floor} · {row.reason}')
    db.commit()
    return present.policy_out(row, db)


@router.get('/audit')
def read_audit(user: User = reader, db: Session = database):
    rows = db.scalars(select(Audit).order_by(Audit.id.desc()).limit(100))
    return [{'actor': row.actor, 'event': row.event, 'subject': row.subject,
             'explanation': row.explanation, 'created_at': present.iso(row.created_at)} for row in rows]
