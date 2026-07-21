import { randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const ids = { bd: "usr_e2e_v9_bd", intern: "usr_e2e_v9_intern", ra: "usr_e2e_v9_ra", project: "prj_e2e_v9_visible", hidden: "prj_e2e_v9_hidden", stage: "stage_e2e_v9", task: "task_e2e_v9" };
const result = { deployment: {}, ai: {}, regression: {}, cleanup: false };

function assert(condition, message) { if (!condition) throw new Error(message); }
function sqlValue(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function runD1(sql) {
  const command = spawnSync(process.execPath, [wrangler, "d1", "execute", "project-brain-db", "--remote", "--command", sql], { cwd: root, encoding: "utf8", windowsHide: true });
  if (command.status !== 0) throw new Error("remote D1 fixture command failed");
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
  if (expected !== undefined) assert(response.status === expected, `${pathname}: expected ${expected}, got ${response.status}`);
  return { response, body };
}
async function login(email, password) {
  const { response } = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), `missing session cookie for ${email}`);
  return cookie;
}
function auth(cookie, method = "GET", body) { return { method, headers: { Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }; }
function hasHan(value) { return /\p{Script=Han}/u.test(String(value)); }
function cleanupSql() { const users = [ids.bd, ids.intern, ids.ra].map(sqlValue).join(","); return `PRAGMA foreign_keys=ON; DELETE FROM projects WHERE id IN (${sqlValue(ids.project)},${sqlValue(ids.hidden)}); DELETE FROM sessions WHERE user_id IN (${users}); DELETE FROM users WHERE id IN (${users});`; }

let failure;
try {
  runD1(cleanupSql());
  const passwords = { bd: randomBytes(18).toString("base64url"), intern: randomBytes(18).toString("base64url"), ra: randomBytes(18).toString("base64url") };
  const hashes = Object.fromEntries(await Promise.all(Object.entries(passwords).map(async ([key, password]) => [key, await passwordHash(password)])));
  runD1(`PRAGMA foreign_keys=ON;
    INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status) VALUES
      (${sqlValue(ids.bd)},'v9-bd@demo.local','V9 Demo BD',${sqlValue(hashes.bd)},'member','grp_bd',0,0,1,1,1,'approved'),
      (${sqlValue(ids.intern)},'v9-intern@demo.local','V9 Demo Intern',${sqlValue(hashes.intern)},'intern','grp_bd',0,0,1,1,1,'approved'),
      (${sqlValue(ids.ra)},'v9-ra@demo.local','V9 Demo RA',${sqlValue(hashes.ra)},'member','grp_general',0,0,1,1,1,'approved');
    INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,goal_summary,start_date,target_date,auto_archive,is_demo,last_activity_at,progress_mode) VALUES
      (${sqlValue(ids.project)},'V9 visible fixture','V9 production E2E','grp_bd',${sqlValue(ids.bd)},'private','active',25,'Language verification','2026-07-01','2026-08-31',0,1,CURRENT_TIMESTAMP,'manual'),
      (${sqlValue(ids.hidden)},'V9 hidden fixture','V9 intern control','grp_bd',${sqlValue(ids.bd)},'private','active',10,'Visibility control','2026-07-01','2026-08-31',0,1,CURRENT_TIMESTAMP,'manual');
    INSERT INTO project_members (project_id,user_id,added_by) VALUES (${sqlValue(ids.project)},${sqlValue(ids.intern)},${sqlValue(ids.bd)});
    INSERT INTO stages (id,project_id,name,position) VALUES (${sqlValue(ids.stage)},${sqlValue(ids.project)},'In progress',0);
    INSERT INTO tasks (id,project_id,stage_id,title,description,assignee_id,due_date,position,created_at,updated_at,done,start_date) VALUES (${sqlValue(ids.task)},${sqlValue(ids.project)},${sqlValue(ids.stage)},'V9 English verification task','Validate language-aware summaries',${sqlValue(ids.bd)},'2026-08-15',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'2026-07-22');`);

  const homepage = await fetch(base); const html = await homepage.text();
  assert(homepage.status === 200 && html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const unauthenticated = await request("/api/projects", {}, 401);
  const bdCookie = await login("v9-bd@demo.local", passwords.bd);
  const internCookie = await login("v9-intern@demo.local", passwords.intern);
  const raCookie = await login("v9-ra@demo.local", passwords.ra);
  const regBefore = await request("/api/regwatch", auth(bdCookie), 200);

  const english = await request("/api/ai/task-summary", auth(bdCookie, "POST", { task_id: ids.task, lang: "en" }), 200);
  const chinese = await request("/api/ai/task-summary", auth(bdCookie, "POST", { task_id: ids.task, lang: "zh" }), 200);
  result.ai.task_summary_en = { status: english.response.status, language: "en", fallback: !!english.body.fallback, summary_has_han: hasHan(english.body.summary), summary_sample: String(english.body.summary).slice(0, 160) };
  result.ai.task_summary_zh = { status: chinese.response.status, language: "zh", fallback: !!chinese.body.fallback, summary_has_han: hasHan(chinese.body.summary), summary_sample: String(chinese.body.summary).slice(0, 160) };
  assert(typeof english.body.summary === "string" && /[A-Za-z]/.test(english.body.summary) && !hasHan(english.body.summary), "English task summary is not English");
  assert(typeof chinese.body.summary === "string" && hasHan(chinese.body.summary), "Chinese task summary is not Traditional Chinese");

  const extract = await request("/api/regwatch/ai-extract", auth(raCookie, "POST", { mode: "single", text: "民國115年7月22日，衛生福利部公告醫療器材標示規定修正，外盒應新增批號，說明書應增加保存條件。" }));
  const extracted = extract.body.entries?.[0];
  assert(extract.response.status === 200 && extracted && hasHan(`${extracted.title} ${extracted.key_points}`), `regwatch extraction did not return Traditional Chinese (${extract.response.status})`);
  result.ai.regwatch_extract = { status: extract.response.status, language: "zh", title_has_han: hasHan(extracted.title), key_points_has_han: hasHan(extracted.key_points) };

  const internProjects = await request("/api/projects", auth(internCookie), 200);
  const internIds = internProjects.body.projects.map((project) => project.id);
  assert(internIds.includes(ids.project) && !internIds.includes(ids.hidden), "intern project visibility regression");
  const regAfter = await request("/api/regwatch", auth(bdCookie), 200);
  assert(regAfter.body.total === regBefore.body.total, "regwatch count changed during V9 E2E");
  result.deployment = { homepage: homepage.status, title: true };
  result.regression = { unauthenticated_api: unauthenticated.response.status, intern_visible_fixture: true, intern_hidden_control: true, intern_project_count: internIds.length, regwatch_expected: 627, regwatch_before: regBefore.body.total, regwatch_after: regAfter.body.total, regwatch_unchanged: true, regwatch_expected_match: regBefore.body.total === 627 };
} catch (error) {
  failure = error;
} finally {
  try { runD1(cleanupSql()); result.cleanup = true; } catch (error) { failure ??= error; }
}

if (failure) result.error = failure.message;
console.log(JSON.stringify(result, null, 2));
if (failure) process.exitCode = 1;
