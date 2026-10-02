-- 聯絡人的電話加一格選填的分機。
ALTER TABLE contacts ADD COLUMN phone_ext TEXT NOT NULL DEFAULT '';

-- 既有資料：「2356-7417#35」「2312-3456 分機 1234」「2312-3456 ext. 12」「2312-3456 轉 12」拆成號碼＋分機。
-- 只拆分機記號後面全是數字、前面還有號碼的；其他寫法維持原樣，讓人自己改。
UPDATE contacts
SET phone_ext = trim(substr(phone, instr(phone, '#') + 1)), phone = trim(substr(phone, 1, instr(phone, '#') - 1), ' ,，')
WHERE phone_ext = '' AND instr(phone, '#') > 1
  AND trim(substr(phone, instr(phone, '#') + 1)) <> '' AND trim(substr(phone, instr(phone, '#') + 1)) NOT GLOB '*[^0-9]*';

UPDATE contacts
SET phone_ext = trim(substr(phone, instr(phone, '分機') + 2), ' :：'), phone = trim(substr(phone, 1, instr(phone, '分機') - 1), ' ,，')
WHERE phone_ext = '' AND instr(phone, '分機') > 1
  AND trim(substr(phone, instr(phone, '分機') + 2), ' :：') <> '' AND trim(substr(phone, instr(phone, '分機') + 2), ' :：') NOT GLOB '*[^0-9]*';

UPDATE contacts
SET phone_ext = trim(substr(phone, instr(lower(phone), 'ext') + 3), ' .:：'), phone = trim(substr(phone, 1, instr(lower(phone), 'ext') - 1), ' ,，')
WHERE phone_ext = '' AND instr(lower(phone), 'ext') > 1
  AND trim(substr(phone, instr(lower(phone), 'ext') + 3), ' .:：') <> '' AND trim(substr(phone, instr(lower(phone), 'ext') + 3), ' .:：') NOT GLOB '*[^0-9]*';

UPDATE contacts
SET phone_ext = trim(substr(phone, instr(phone, '轉') + 1), ' :：'), phone = trim(substr(phone, 1, instr(phone, '轉') - 1), ' ,，')
WHERE phone_ext = '' AND instr(phone, '轉') > 1
  AND trim(substr(phone, instr(phone, '轉') + 1), ' :：') <> '' AND trim(substr(phone, instr(phone, '轉') + 1), ' :：') NOT GLOB '*[^0-9]*';
