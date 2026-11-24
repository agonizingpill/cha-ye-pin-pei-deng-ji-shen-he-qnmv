from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, model_validator

from .constants import Grade

Code = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r'^[A-Z0-9][A-Z0-9-]{1,39}$')]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)]
Score = Annotated[int, Field(ge=0, le=100)]


class Credentials(BaseModel):
    username: Short
    password: str = Field(min_length=1, max_length=128)


class LotInput(BaseModel):
    code: Code
    cultivar: Short
    origin: Short
    received: date
    kilograms: Decimal = Field(gt=0, max_digits=9, decimal_places=2)
    roast: Short


class PanelInput(BaseModel):
    aroma: Score
    body: Score
    sweetness: Score
    leaf: Score
    defect: Annotated[int, Field(ge=0, le=20)]
    note: Note


class RepanelInput(PanelInput):
    grade: Grade


class ShareInput(BaseModel):
    lot_id: int = Field(gt=0)
    percent: Decimal = Field(gt=0, le=100, max_digits=5, decimal_places=2)


class RecipeInput(BaseModel):
    code: Code
    name: Short
    note: Note
    shares: list[ShareInput] = Field(min_length=2, max_length=8)

    @model_validator(mode='after')
    def distinct_lots(self):
        if len({share.lot_id for share in self.shares}) != len(self.shares):
            raise ValueError('每个原料批次只能在拼配中出现一次')
        return self


class SampleInput(BaseModel):
    seal: Code
    grams: int = Field(ge=20, le=1000)
    cabinet: Short


class Decision(BaseModel):
    note: Note


class ThresholdInput(Decision):
    floor: Decimal = Field(ge=Decimal('.500'), le=Decimal('.990'), decimal_places=3)
