import { randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const users = {
  bd: { id: "usr_e2e_v8_bd", email: "v8-bd@demo.local", name: "V8 Demo BD", role: "member", group: "grp_bd" },
  clinical: { id: "usr_e2e_v8_clin", email: "v8-clin@demo.local", name: "V8 Demo Clinical", role: "member", group: "grp_clinical" },
  intern: { id: "usr_e2e_v8_intern", email: "v8-intern@demo.local", name: "V8 Demo Intern", role: "intern", group: "grp_bd" },
  manager: { id: "usr_e2e_v8_manager", email: "v8-manager@demo.local", name: "V8 Demo Manager", role: "admin", group: "grp_general" },
};
const fixture = {
  publicProject: { id: "prj_e2e_v8_public", name: "V8 E2E 公開 BD 專案" },
  privateProject: { id: "prj_e2e_v8_private", name: "V8 E2E 保密 BD 專案" },
  stage: "stage_e2e_v8",
  task: "task_e2e_v8",
  update: "update_e2e_v8",
  kr: "kr_e2e_v8",
  bdCase: "bdcase_e2e_v8",
  bdEvent: "bdevent_e2e_v8",
  fee: "fee_e2e_v8",
};
const result = { reports: {}, permissions: {}, timeline: {}, regression: {}, cleanup: false };
const createdReportIds = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
function sqlValue(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function runD1(sql) {
  const command = spawnSync(process.execPath, [wrangler, "d1", "execute", "project-brain-db", "--remote", "--command", sql], { cwd: root, encoding: "utf8", windowsHide: true });
  if (command.status !== 0) throw new Error("remote D1 command failed");
}
async function passwordHash(password) {
  const salt = randomBytes(16);
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `pbkdf2$100000$${salt.toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}
async function request(pathname, options = {}, expected) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) headers.set("Origin", base);
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (expected !== undefined) assert(response.status === expected, `${pathname}: expected ${expected}, got ${response.status}, body=${JSON.stringify(body)}`);
  return { response, body };
}
async function login(user, password) {
  const { response } = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: user.email, password }) }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), `missing session cookie for ${user.email}`);
  return cookie;
}
function auth(cookie, method = "GET", body) { return { method, headers: { Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }; }
function addDays(date, days) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function taipeiDate() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function previousWeek() { const local = new Date(Date.now() + 8 * 60 * 60 * 1000); const day = local.getUTCDay() || 7; const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day - 6)); return { start: monday.toISOString().slice(0, 10), end: addDays(monday.toISOString().slice(0, 10), 6) }; }
function previousMonth() { const local = new Date(Date.now() + 8 * 60 * 60 * 1000); const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1)); const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 0)); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; }
function cleanupSql() {
  const userIds = Object.values(users).map((user) => sqlValue(user.id)).join(",");
  const reportIds = createdReportIds.length ? ` OR id IN (${createdReportIds.map(sqlValue).join(",")})` : "";
  return `
    DELETE FROM ai_reports WHERE content_md LIKE ${sqlValue(`%${fixture.publicProject.name}%`)}${reportIds};
    DELETE FROM projects WHERE id IN (${sqlValue(fixture.publicProject.id)},${sqlValue(fixture.privateProject.id)});
    DELETE FROM sessions WHERE user_id IN (${userIds});
    DELETE FROM users WHERE id IN (${userIds});
  `;
}

let failure;
try {
  runD1(cleanupSql());
  const passwords = Object.fromEntries(await Promise.all(Object.keys(users).map(async (key) => [key, randomBytes(18).toString("base64url")])));
  const hashes = Object.fromEntries(await Promise.all(Object.entries(passwords).map(async ([key, password]) => [key, await passwordHash(password)])));
  const week = previousWeek(); const month = previousMonth(); const today = taipeiDate();
  runD1(`
    INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status) VALUES
      (${sqlValue(users.bd.id)},${sqlValue(users.bd.email)},${sqlValue(users.bd.name)},${sqlValue(hashes.bd)},'member','grp_bd',0,0,1,1,1,'approved'),
      (${sqlValue(users.clinical.id)},${sqlValue(users.clinical.email)},${sqlValue(users.clinical.name)},${sqlValue(hashes.clinical)},'member','grp_clinical',0,0,1,1,1,'approved'),
      (${sqlValue(users.intern.id)},${sqlValue(users.intern.email)},${sqlValue(users.intern.name)},${sqlValue(hashes.intern)},'intern','grp_bd',0,0,1,1,1,'approved'),
      (${sqlValue(users.manager.id)},${sqlValue(users.manager.email)},${sqlValue(users.manager.name)},${sqlValue(hashes.manager)},'admin','grp_general',0,0,1,1,1,'approved');
    INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,goal_summary,start_date,target_date,auto_archive,is_demo,last_activity_at,progress_mode) VALUES
      (${sqlValue(fixture.publicProject.id)},${sqlValue(fixture.publicProject.name)},'V8 production E2E','grp_bd',${sqlValue(users.bd.id)},'group','active',65,'驗證週月報與時間軸',${sqlValue(month.start)},${sqlValue(today)},0,1,CURRENT_TIMESTAMP,'manual'),
      (${sqlValue(fixture.privateProject.id)},${sqlValue(fixture.privateProject.name)},'V8 confidential fixture','grp_bd',${sqlValue(users.manager.id)},'private','active',40,'不得出現在一般組別報告',${sqlValue(month.start)},${sqlValue(today)},0,1,CURRENT_TIMESTAMP,'manual');
    INSERT INTO project_members (project_id,user_id,added_by) VALUES (${sqlValue(fixture.publicProject.id)},${sqlValue(users.intern.id)},${sqlValue(users.bd.id)});
    INSERT INTO stages (id,project_id,name,position) VALUES (${sqlValue(fixture.stage)},${sqlValue(fixture.publicProject.id)},'進行中',0);
    INSERT INTO tasks (id,project_id,stage_id,title,description,assignee_id,due_date,position,created_at,updated_at,done,done_at,start_date) VALUES (${sqlValue(fixture.task)},${sqlValue(fixture.publicProject.id)},${sqlValue(fixture.stage)},'V8 E2E 任務條','timeline task',${sqlValue(users.bd.id)},${sqlValue(week.end)},0,${sqlValue(`${week.start} 08:00:00`)},${sqlValue(`${week.end} 08:00:00`)},1,${sqlValue(`${week.end} 08:00:00`)},${sqlValue(week.start)});
    INSERT INTO progress_updates (id,project_id,author_id,content,progress_snapshot,created_at) VALUES (${sqlValue(fixture.update)},${sqlValue(fixture.publicProject.id)},${sqlValue(users.bd.id)},'V8 E2E 完成報表與泳道驗證',65,${sqlValue(`${week.start} 09:00:00`)});
    INSERT INTO key_results (id,project_id,title,owner_id,quarter,status,note,position,created_at,updated_at) VALUES (${sqlValue(fixture.kr)},${sqlValue(fixture.publicProject.id)},'V8 E2E KR',${sqlValue(users.bd.id)},'2026Q3','完成','E2E',0,${sqlValue(`${week.start} 09:00:00`)},${sqlValue(`${week.end} 09:00:00`)});
    INSERT INTO bd_cases (id,project_id,case_name,product_name,case_type,current_status) VALUES (${sqlValue(fixture.bdCase)},${sqlValue(fixture.publicProject.id)},'V8 E2E 案件','測試產品','藥品','審查中');
    INSERT INTO bd_case_events (id,case_id,event_date,event_type,description,created_by) VALUES (${sqlValue(fixture.bdEvent)},${sqlValue(fixture.bdCase)},${sqlValue(week.start)},'送件','V8 E2E',${sqlValue(users.bd.id)});
    INSERT INTO bd_fees (id,project_id,case_id,fee_date,category,amount,currency,note,created_by) VALUES (${sqlValue(fixture.fee)},${sqlValue(fixture.publicProject.id)},${sqlValue(fixture.bdCase)},${sqlValue(month.start)},'規費',1234,'TWD','V8 E2E',${sqlValue(users.bd.id)});
  `);

  const homepage = await fetch(base); const html = await homepage.text();
  assert(homepage.status === 200 && html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const unauthenticated = await request("/api/timeline", {}, 401);
  const bdCookie = await login(users.bd, passwords.bd);
  const clinicalCookie = await login(users.clinical, passwords.clinical);
  const internCookie = await login(users.intern, passwords.intern);
  const regBefore = await request("/api/regwatch", auth(bdCookie), 200);
  result.regression = { homepage: homepage.status, title: true, unauthenticated_api: unauthenticated.response.status, expected_regwatch: 627, regwatch_before: regBefore.body.total };

  for (const [period, expectedType] of [["last-week", "week"], ["last-month", "month"]]) {
    const generated = await request("/api/reports/ai/generate", auth(bdCookie, "POST", { scope: "grp_bd", period, include_private: false }), 201);
    assert(generated.body.report?.id, `${period} report id missing`); createdReportIds.push(generated.body.report.id);
    const content = String(generated.body.report.content_md ?? "");
    assert(generated.body.report.period_type === expectedType, `${period} report type mismatch`);
    assert(content.includes(fixture.publicProject.name), `${period} report missing public project`);
    assert(!content.includes(fixture.privateProject.name), `${period} report leaked private project`);
    assert(content.includes("保密專案未納入"), `${period} report missing privacy note`);
    result.reports[expectedType] = { status: generated.response.status, scope: generated.body.report.scope_name, public_project: true, private_project_excluded: true, privacy_note: true, fallback: !!generated.body.fallback };
  }

  const forbiddenGenerate = await request("/api/reports/ai/generate", auth(bdCookie, "POST", { scope: "grp_clinical", period: "last-week", include_private: false }), 403);
  const otherGroupRead = await request(`/api/reports/ai/${createdReportIds[0]}`, auth(clinicalCookie), 403);
  const internRead = await request(`/api/reports/ai/${createdReportIds[0]}`, auth(internCookie), 200);
  result.permissions = { cross_group_generate: forbiddenGenerate.response.status, cross_group_read: otherGroupRead.response.status, same_group_intern_read: internRead.response.status };

  const timeline = await request("/api/timeline", auth(bdCookie), 200);
  const bdLane = timeline.body.groups?.find((group) => group.id === "grp_bd");
  const publicProject = bdLane?.projects?.find((project) => project.id === fixture.publicProject.id);
  assert(Array.isArray(timeline.body.groups) && bdLane, "timeline group lane missing");
  assert(publicProject?.tasks?.some((task) => task.id === fixture.task && task.start_date === week.start && task.due_date === week.end && task.assignee_name === users.bd.name), "timeline task bar data missing");
  assert(!bdLane.projects.some((project) => project.id === fixture.privateProject.id), "timeline leaked private project");
  const internTimeline = await request("/api/timeline", auth(internCookie), 200);
  const internProjects = internTimeline.body.groups?.flatMap((group) => group.projects) ?? [];
  assert(internProjects.some((project) => project.id === fixture.publicProject.id) && !internProjects.some((project) => project.id === fixture.privateProject.id), "intern timeline scope mismatch");
  result.timeline = { groups: timeline.body.groups.length, bd_lane: true, task_data: true, private_hidden: true, intern_scope: true };

  const regAfter = await request("/api/regwatch", auth(bdCookie), 200);
  assert(regAfter.body.total === regBefore.body.total, `regwatch count changed from ${regBefore.body.total} to ${regAfter.body.total}`);
  result.regression.regwatch_after = regAfter.body.total;
  result.regression.unchanged_during_e2e = true;
  if (regBefore.body.total !== 627) throw new Error(`expected 627 existing regwatch entries, got ${regBefore.body.total}`);
} catch (error) {
  failure = error;
} finally {
  try { runD1(cleanupSql()); result.cleanup = true; } catch (error) { failure ??= error; }
}

if (failure) result.error = failure.message;
console.log(JSON.stringify(result, null, 2));
if (failure) process.exitCode = 1;
