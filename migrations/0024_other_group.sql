-- 內建「其他」組：放不進任何一組的專案。管理員若已自己建過叫「其他」的組就不重複建立。
-- 這一組的新專案預設可見性是「全公司」（src/project-groups.ts）。
INSERT INTO groups (id, name, type)
SELECT 'grp_other', '其他', 'general'
WHERE NOT EXISTS (SELECT 1 FROM groups WHERE id = 'grp_other' OR TRIM(name) IN ('其他', '其它'));
