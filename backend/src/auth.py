import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .constants import Role
from .db import get_db
from .models import User

secret = os.environ['JWT_SECRET']
bearer = OAuth2PasswordBearer(tokenUrl='session')


def password_hash(password, salt=None):
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 310_000).hex()
    return f'{salt}:{digest}'


def matches(password, encoded):
    return hmac.compare_digest(password_hash(password, encoded.split(':')[0]), encoded)


def issue(user):
    expiry = datetime.now(timezone.utc) + timedelta(hours=8)
    return jwt.encode({'sub': str(user.id), 'exp': expiry, 'iss': 'tea-blend-grading'}, secret, algorithm='HS256')


def actor(request: Request, token: str = Depends(bearer), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, secret, algorithms=['HS256'], issuer='tea-blend-grading', options={'require': ['exp', 'sub']})
        user = db.get(User, int(payload['sub']))
    except (jwt.InvalidTokenError, ValueError):
        user = None
    if user is None:
        raise HTTPException(401, '登录已失效，请重新登录')
    request.state.actor = user.username
    return user


def permits(*roles: Role):
    def check(user: User = Depends(actor)):
        if user.role not in roles:
            raise HTTPException(403, '当前身份没有此操作权限')
        return user
    return check
