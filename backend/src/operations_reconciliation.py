"""Additional operational reconciliation rules for this project."""

RECONCILIATION_VIEWS = {
    'blend-panel-coverage': (
        '拼配原料品评覆盖',
        '逐配方核对有占比的原料批是否具备品评，将缺少原料品评的配方交给品控补测。',
        ['配方', '修订号', '原料批', '来源', '占比', '原料品评次数', '最近品评', '补测建议'],
        """
SELECT r.code,r.revision,l.code,l.origin,s.percent,COUNT(p.id),MAX(p.created_at),
       CASE WHEN COUNT(p.id)=0 THEN '待补原料品评' ELSE '原料品评已登记' END
FROM blend_share s JOIN blend_recipe r ON r.id=s.recipe_id JOIN tea_lot l ON l.id=s.lot_id
LEFT JOIN sensory_panel p ON p.lot_id=l.id WHERE s.percent>0
GROUP BY r.code,r.revision,l.code,l.origin,s.percent ORDER BY COUNT(p.id),r.code,l.code
""",
    ),
}
