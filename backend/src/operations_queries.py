"""Business queries over authoritative project records."""

from .operations_reconciliation import RECONCILIATION_VIEWS

VIEWS = {
    'retention-coverage': (
        '签发等级留样链',
        '从已签发修订的冻结配方读取原料封签，分别核对原料库位和拼配留样封签。',
        ['配方', '评审修订', '签发等级', '原料批次', '配比 %', '冻结封签', '原料库位', '拼配封签', '完整性'],
        """
SELECT recipe.code,r.revision,r.final_grade,i.lot_code,i.share_pct,i.raw_seal,raw.cabinet,blend.seal,
       CASE WHEN raw.id IS NULL THEN '原料封签待复核' WHEN blend.id IS NULL THEN '待拼配封样' ELSE '证据完整' END
FROM grade_review r JOIN blend_recipe recipe ON recipe.id=r.recipe_id
JOIN JSON_TABLE(r.snapshot,'$.ingredients[*]' COLUMNS (
    lot_code VARCHAR(40) PATH '$.lot', share_pct DECIMAL(5,2) PATH '$.percent', raw_seal VARCHAR(40) PATH '$.seal'
)) i ON TRUE
LEFT JOIN tea_lot l ON l.code=i.lot_code LEFT JOIN retained_sample raw ON raw.lot_id=l.id AND raw.seal=i.raw_seal
LEFT JOIN retained_sample blend ON blend.review_id=r.id
WHERE r.signed_by IS NOT NULL AND r.final_grade IS NOT NULL ORDER BY r.id DESC,i.lot_code
""",
    ),
    **RECONCILIATION_VIEWS,
}
