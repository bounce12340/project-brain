-- 聯絡人的電話把區碼分成獨立一格。
ALTER TABLE contacts ADD COLUMN phone_area TEXT NOT NULL DEFAULT '';

-- 既有資料：「04-3702-2680」拆成「04」＋「3702-2680」，「(02)2312-3456」拆成「02」＋「2312-3456」。
-- 只拆看得出是區碼的（0 開頭、2～4 位數字）；09 開頭是手機門號，不動。
UPDATE contacts
SET phone_area = substr(phone, 1, instr(phone, '-') - 1), phone = trim(substr(phone, instr(phone, '-') + 1))
WHERE phone_area = '' AND phone LIKE '0%-%' AND phone NOT LIKE '09%'
  AND instr(phone, '-') BETWEEN 3 AND 5 AND substr(phone, 1, instr(phone, '-') - 1) NOT GLOB '*[^0-9]*';

UPDATE contacts
SET phone_area = substr(phone, 2, instr(phone, ')') - 2), phone = trim(substr(phone, instr(phone, ')') + 1))
WHERE phone_area = '' AND phone LIKE '(0%)%' AND phone NOT LIKE '(09%'
  AND instr(phone, ')') BETWEEN 4 AND 6 AND substr(phone, 2, instr(phone, ')') - 2) NOT GLOB '*[^0-9]*';
