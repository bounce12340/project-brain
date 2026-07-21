PRAGMA foreign_keys = ON;

INSERT INTO groups (id, name, type) VALUES
  ('grp_clinical', '臨床組', 'clinical'),
  ('grp_bd', 'BD組', 'bd'),
  ('grp_general', 'RA/PV組', 'general');

INSERT INTO users (id, email, name, password_hash, role, group_id, must_change_password, is_demo) VALUES
  ('usr_admin', 'bounceto12340@gmail.com', '管理者', 'pbkdf2$100000$F0w9bjp3fnmg84bq9739CQ==$ifMJgr7Fu7ekxy60Mh1BEhPVZqcW9Uej3LNHOuiw8es=', 'admin', 'grp_general', 1, 0),
  ('usr_clinical1', 'clinical1@demo.local', '林曉臨', 'pbkdf2$100000$F0w9bjp3fnmg84bq9739CQ==$ifMJgr7Fu7ekxy60Mh1BEhPVZqcW9Uej3LNHOuiw8es=', 'member', 'grp_clinical', 0, 1),
  ('usr_clinical2', 'clinical2@demo.local', '陳收案', 'pbkdf2$100000$F0w9bjp3fnmg84bq9739CQ==$ifMJgr7Fu7ekxy60Mh1BEhPVZqcW9Uej3LNHOuiw8es=', 'member', 'grp_clinical', 0, 1),
  ('usr_bd1', 'bd1@demo.local', '王必達', 'pbkdf2$100000$F0w9bjp3fnmg84bq9739CQ==$ifMJgr7Fu7ekxy60Mh1BEhPVZqcW9Uej3LNHOuiw8es=', 'member', 'grp_bd', 0, 1),
  ('usr_intern1', 'intern1@demo.local', '李實習', 'pbkdf2$100000$F0w9bjp3fnmg84bq9739CQ==$ifMJgr7Fu7ekxy60Mh1BEhPVZqcW9Uej3LNHOuiw8es=', 'intern', 'grp_clinical', 0, 1);

INSERT INTO stage_templates (id, name, group_id, stages_json) VALUES
  ('tpl_bd', 'BD 查驗登記流程', 'grp_bd', '["準備文件","送件","審查中","補件","核准領證","結案"]'),
  ('tpl_clinical', '臨床試驗流程', 'grp_clinical', '["啟動準備","IRB 送審","收案中","結案","報告"]'),
  ('tpl_general', '一般專案', NULL, '["待辦","進行中","完成"]');

INSERT INTO projects (id, name, description, group_id, owner_id, visibility, status, progress, goal_summary, start_date, target_date, is_demo, last_activity_at) VALUES
  ('prj_clinical', '多中心臨床收案計畫', '追蹤各試驗中心收案進度與里程碑。', 'grp_clinical', 'usr_clinical1', 'group', 'active', 42, '在 2026 年第三季完成 60 位受試者收案。', '2026-05-01', '2026-09-30', 1, '2026-07-20T02:00:00Z'),
  ('prj_bd', '新藥查驗登記案', '管理送件、補件、核准歷程與相關費用。', 'grp_bd', 'usr_bd1', 'group', 'active', 55, '完成 TFDA 查驗登記並於目標日前取得核准。', '2026-04-01', '2026-11-30', 1, '2026-07-19T06:30:00Z'),
  ('prj_general', 'RA/PV 月度例行作業', '全公司可見的法規與藥物安全例行工作。', 'grp_general', 'usr_admin', 'all', 'active', 68, '準時完成每月例行申報與訊號追蹤。', '2026-01-01', '2026-12-31', 1, '2026-07-18T01:00:00Z'),
  ('prj_private', '策略合作保密評估', '機密商務策略評估。', 'grp_clinical', 'usr_clinical1', 'private', 'paused', 25, '完成合作標的之機密可行性評估。', '2026-06-15', '2026-10-15', 1, '2026-07-10T08:00:00Z');

INSERT INTO project_members (project_id, user_id, added_by) VALUES
  ('prj_clinical', 'usr_clinical2', 'usr_clinical1'),
  ('prj_clinical', 'usr_intern1', 'usr_clinical1');

INSERT INTO stages (id, project_id, name, color, position) VALUES
  ('st_clin_1', 'prj_clinical', '啟動準備', '#64748b', 0),
  ('st_clin_2', 'prj_clinical', 'IRB 送審', '#8b5cf6', 1),
  ('st_clin_3', 'prj_clinical', '收案中', '#4f46e5', 2),
  ('st_clin_4', 'prj_clinical', '結案', '#0f766e', 3),
  ('st_clin_5', 'prj_clinical', '報告', '#15803d', 4),
  ('st_bd_1', 'prj_bd', '準備文件', '#64748b', 0),
  ('st_bd_2', 'prj_bd', '送件', '#4f46e5', 1),
  ('st_bd_3', 'prj_bd', '審查中', '#d97706', 2),
  ('st_bd_4', 'prj_bd', '補件', '#dc2626', 3),
  ('st_bd_5', 'prj_bd', '核准領證', '#0f766e', 4),
  ('st_bd_6', 'prj_bd', '結案', '#15803d', 5),
  ('st_gen_1', 'prj_general', '待辦', '#64748b', 0),
  ('st_gen_2', 'prj_general', '進行中', '#4f46e5', 1),
  ('st_gen_3', 'prj_general', '完成', '#15803d', 2),
  ('st_priv_1', 'prj_private', '待辦', '#64748b', 0),
  ('st_priv_2', 'prj_private', '進行中', '#4f46e5', 1),
  ('st_priv_3', 'prj_private', '完成', '#15803d', 2);

INSERT INTO tasks (id, project_id, stage_id, title, description, assignee_id, due_date, position) VALUES
  ('tsk_clin_1', 'prj_clinical', 'st_clin_3', '追蹤台北中心收案', '確認本週篩選名單。', 'usr_clinical2', '2026-07-24', 0),
  ('tsk_clin_2', 'prj_clinical', 'st_clin_3', '彙整不良事件', '更新安全性清單。', 'usr_clinical1', '2026-07-28', 1),
  ('tsk_bd_1', 'prj_bd', 'st_bd_3', '回覆審查問題', '準備品質模組說明。', 'usr_bd1', '2026-07-30', 0),
  ('tsk_gen_1', 'prj_general', 'st_gen_2', '七月安全性報告', '', 'usr_admin', '2026-07-31', 0);

INSERT INTO milestones (id, project_id, title, due_date, done, done_at, position) VALUES
  ('ms_clin_1', 'prj_clinical', '完成首位受試者收案', '2026-05-31', 1, '2026-05-28T06:00:00Z', 0),
  ('ms_clin_2', 'prj_clinical', '累計收案 30 人', '2026-07-18', 0, NULL, 1),
  ('ms_bd_1', 'prj_bd', '完成正式送件', '2026-06-30', 1, '2026-06-26T03:30:00Z', 0),
  ('ms_gen_1', 'prj_general', '七月例行申報', '2026-07-31', 0, NULL, 0);

INSERT INTO progress_updates (id, project_id, author_id, content, progress_snapshot, created_at) VALUES
  ('upd_clin_1', 'prj_clinical', 'usr_clinical1', '已完成三個中心啟動，累計收案 25 人。', 40, '2026-07-14T02:00:00Z'),
  ('upd_clin_2', 'prj_clinical', 'usr_clinical2', '台中中心本週新增 2 人，已協助更新追蹤表。', 42, '2026-07-20T02:00:00Z'),
  ('upd_bd_1', 'prj_bd', 'usr_bd1', 'TFDA 已進入實質審查，等待第一輪問題。', 55, '2026-07-19T06:30:00Z'),
  ('upd_gen_1', 'prj_general', 'usr_admin', '七月例行項目已完成三分之二。', 68, '2026-07-18T01:00:00Z'),
  ('upd_priv_1', 'prj_private', 'usr_clinical1', '完成第一階段資料盤點。', 25, '2026-07-10T08:00:00Z');

INSERT INTO clinical_settings (project_id, target_n) VALUES ('prj_clinical', 60);
INSERT INTO clinical_enrollments (id, project_id, record_date, site, count, note, created_by) VALUES
  ('enr_1', 'prj_clinical', '2026-07-10', '台北中心', 8, '第一批完成', 'usr_clinical1'),
  ('enr_2', 'prj_clinical', '2026-07-15', '台中中心', 7, '', 'usr_clinical2'),
  ('enr_3', 'prj_clinical', '2026-07-20', '高雄中心', 10, '進度良好', 'usr_clinical2');

INSERT INTO bd_cases (id, project_id, case_name, product_name, case_type, submission_no, current_status, submitted_at, expected_approval, note) VALUES
  ('case_bd_1', 'prj_bd', '新藥查驗登記', 'UIC-101', 'NDA', 'TFDA-2026-00101', '審查中', '2026-06-26', '2026-10-30', '已完成送件。');
INSERT INTO bd_case_events (id, case_id, event_date, event_type, description, created_by) VALUES
  ('evt_bd_1', 'case_bd_1', '2026-06-26', '送件', '完成電子與紙本送件。', 'usr_bd1'),
  ('evt_bd_2', 'case_bd_1', '2026-07-12', '進入審查', '收到案號並進入實質審查。', 'usr_bd1');
INSERT INTO bd_fees (id, project_id, case_id, fee_date, category, amount, currency, note, created_by) VALUES
  ('fee_bd_1', 'prj_bd', 'case_bd_1', '2026-06-26', '規費', 120000, 'TWD', '查驗登記規費', 'usr_bd1'),
  ('fee_bd_2', 'prj_bd', 'case_bd_1', '2026-07-05', '顧問費', 45000, 'TWD', '送件文件審閱', 'usr_bd1');

INSERT INTO todos (id, user_id, title, due_date, project_id) VALUES
  ('todo_admin_1', 'usr_admin', '檢視本週專案週報', '2026-07-21', 'prj_general'),
  ('todo_clin_1', 'usr_clinical1', '確認逾期里程碑', '2026-07-21', 'prj_clinical');

INSERT INTO notifications (id, user_id, type, title, body, link) VALUES
  ('noti_admin_1', 'usr_admin', 'system', '歡迎使用專案進度大腦', '示範資料已準備完成。', '/');
