import logging
from decimal import Decimal

from fastapi import HTTPException
from redis import RedisError
from sqlalchemy import select

from .constants import ATTRIBUTES, ReviewState as State
from .db import QUEUE, redis
from .grade_model import digest
from .models import Audit, BlendRecipe, BlendShare, GradeReview, RetainedSample, SensoryPanel, TeaLot, ThresholdPolicy

logger = logging.getLogger(__name__)


def record(db, user, event, subject, explanation):
    db.add(Audit(actor=user.username if hasattr(user, 'username') else user, event=event,
                 subject=str(subject), explanation=explanation))


def require(db, model, key, lock=False):
    row = db.get(model, key, with_for_update=lock)
    if row is None:
        raise HTTPException(404, '记录不存在')
    return row


def sample_for(db, **reference):
    return db.scalar(select(RetainedSample).filter_by(**reference))


def lot_state(db, lot):
    if not lot.panels:
        return 'awaiting_panel'
    if not sample_for(db, lot_id=lot.id):
        return 'awaiting_sample'
    return 'ready'


def replace_shares(db, recipe, data):
    for share in data.shares:
        require(db, TeaLot, share.lot_id)
    incoming = {share.lot_id: share.percent for share in data.shares}
    for existing in list(recipe.shares):
        if existing.lot_id in incoming:
            existing.percent = incoming.pop(existing.lot_id)
        else:
            recipe.shares.remove(existing)
    recipe.shares.extend(BlendShare(lot_id=key, percent=percent) for key, percent in incoming.items())


def latest_policy(db):
    policy = db.scalar(select(ThresholdPolicy).order_by(ThresholdPolicy.id.desc()).limit(1))
    if policy is None:
        raise HTTPException(409, '请主管先登记模型阈值版本')
    return policy


def freeze(db, recipe):
    total = sum((share.percent for share in recipe.shares), Decimal('0'))
    if total != Decimal('100.00'):
        raise HTTPException(409, f'配比为 {total:.2f}%，必须闭合至 100.00%')
    ingredients = []
    for share in recipe.shares:
        lot = share.lot
        sample = sample_for(db, lot_id=lot.id)
        if sample is None:
            raise HTTPException(409, f'{lot.code} 缺失原料留样，封签登记后再送审')
        if not lot.panels:
            raise HTTPException(409, f'{lot.code} 缺失感官评审，请补录')
        panel = lot.panels[-1]
        ingredients.append({'lot': lot.code, 'percent': str(share.percent), 'seal': sample.seal,
                            'panel_id': panel.id, 'scores': {key: getattr(panel, key) for key in ATTRIBUTES}})
    policy = latest_policy(db)
    snapshot = {'code': recipe.code, 'revision': recipe.revision, 'ingredients': ingredients,
                'policy_version': policy.id, 'policy_floor': str(policy.floor)}
    return GradeReview(recipe_id=recipe.id, revision=recipe.revision, threshold_id=policy.id,
                       state=State.QUEUED, snapshot=snapshot, digest=digest(snapshot))


def wake(review_id):
    try:
        redis.rpush(QUEUE, review_id)
    except RedisError:
        logger.warning('Redis notification failed for review %s; database polling will recover', review_id)


def expect(review, *states):
    if review.state not in states:
        raise HTTPException(409, f'审核状态 {review.state} 不支持该操作')


def independent(db, review, user):
    recipe = require(db, BlendRecipe, review.recipe_id)
    if recipe.author_id == user.id:
        raise HTTPException(403, '配方作者不能复评或审核自己的配方')
    return recipe


def repanel(db, review, user, data):
    independent(db, review, user)
    expect(review, State.REPANEL)
    db.add(SensoryPanel(review_id=review.id, author_id=user.id, **data.model_dump()))
    review.state = State.VERIFY
    record(db, user, 'panel.recheck', review.id, data.note)


def verify(db, review, user, note):
    independent(db, review, user)
    expect(review, State.VERIFY)
    panel = db.scalar(select(SensoryPanel).filter_by(review_id=review.id))
    review.final_grade = panel.grade if panel else review.result['candidate']
    review.verified_by = user.id
    review.state = State.SIGNOFF
    record(db, user, 'grade.verify', review.id, note)


def approve(db, review, user, note):
    independent(db, review, user)
    expect(review, State.SIGNOFF)
    if review.verified_by == user.id:
        raise HTTPException(403, '签发和初审须由两人分别完成')
    review.signed_by = user.id
    review.state = State.APPROVED
    record(db, user, 'grade.signoff', review.id, note)
