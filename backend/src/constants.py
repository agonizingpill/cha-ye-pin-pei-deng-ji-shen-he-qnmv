from enum import StrEnum


class Role(StrEnum):
    OPERATOR = 'operator'
    SUPERVISOR = 'supervisor'
    VIEWER = 'viewer'


class ReviewState(StrEnum):
    QUEUED = 'queued'
    FAILED = 'failed'
    REPANEL = 'repanel'
    VERIFY = 'verify'
    SIGNOFF = 'signoff'
    APPROVED = 'approved'
    SEALED = 'sealed'


class RecalcState(StrEnum):
    QUEUED = 'queued'
    MATCHED = 'matched'
    MISMATCHED = 'mismatched'
    FAILED = 'failed'


class Grade(StrEnum):
    SELECTION = 'selection'
    STANDARD = 'standard'
    SECONDARY = 'secondary'


ATTRIBUTES = ('aroma', 'body', 'sweetness', 'leaf', 'defect')
MODEL_SEED = 67
MODEL_VERSION = 'wuyi-panel-v1'
