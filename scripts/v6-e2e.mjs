import { randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const actorIds = ["usr_e2e_v6_admin", "usr_e2e_v6_qa", "usr_e2e_v6_ra", "usr_e2e_v6_intern"];
const emails = {
  admin: "v6-admin@demo.local",
  qa: "v6-qa@demo.local",
  ra: "v6-ra@demo.local",
  intern: "v6-intern@demo.local",
};
const names = { qaProject: "V6 E2E QA 專案", importProject: "V6 E2E 匯入專案" };
const regTitles = ["V6 E2E RA 法規", "V6 E2E 匯入法規一", "V6 E2E 匯入法規二"];
const externalKey = "v6-e2e-import-20260721";
const report = { regression: {}, qa: {}, okr: {}, ccr: {}, regwatch: {}, import: {}, cleanup: false };

function sqlValue(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function runD1(sql) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "project-brain-db", "--remote", "--command", sql], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("remote D1 command failed");
}
async function passwordHash(password) {
  const salt = randomBytes(16);
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `pbkdf2$100000$${salt.toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
async function request(pathname, options = {}, expected) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) headers.set("Origin", base);
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const text = await response.text();
  let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
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
function addDays(date, days) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function cleanupSql() {
  const userList = actorIds.map(sqlValue).join(",");
  const titleList = regTitles.map(sqlValue).join(",");
  return `
    DELETE FROM audit_log WHERE user_id IN (${userList});
    DELETE FROM reg_entries WHERE title IN (${titleList});
    DELETE FROM projects WHERE external_key=${sqlValue(externalKey)} OR name IN (${sqlValue(names.qaProject)},${sqlValue(names.importProject)});
    DELETE FROM sessions WHERE user_id IN (${userList});
    DELETE FROM users WHERE id IN (${userList});
  `;
}

let failure;
try {
  runD1(cleanupSql());
  const passwords = Object.fromEntries(await Promise.all(Object.keys(emails).map(async (key) => [key, randomBytes(18).toString("base64url")])));
  const hashes = Object.fromEntries(await Promise.all(Object.entries(passwords).map(async ([key, value]) => [key, await passwordHash(value)])));
  runD1(`
    INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status) VALUES
      ('usr_e2e_v6_admin',${sqlValue(emails.admin)},'V6 Demo Admin',${sqlValue(hashes.admin)},'admin','grp_qa',0,0,1,1,1,'approved'),
      ('usr_e2e_v6_qa',${sqlValue(emails.qa)},'V6 Demo QA',${sqlValue(hashes.qa)},'member','grp_qa',0,0,1,1,1,'approved'),
      ('usr_e2e_v6_ra',${sqlValue(emails.ra)},'V6 Demo RA',${sqlValue(hashes.ra)},'member','grp_general',0,0,1,1,1,'approved'),
      ('usr_e2e_v6_intern',${sqlValue(emails.intern)},'V6 Demo Intern',${sqlValue(hashes.intern)},'intern','grp_clinical',0,0,1,1,1,'approved');
  `);

  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200 && html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const unauthenticated = await request("/api/projects", {}, 401);
  report.regression = { homepage: homepage.status, title: true, unauthenticated_api: unauthenticated.response.status };

  const adminCookie = await login(emails.admin, passwords.admin);
  const qaCookie = await login(emails.qa, passwords.qa);
  const raCookie = await login(emails.ra, passwords.ra);
  const internCookie = await login(emails.intern, passwords.intern);

  const projectCreate = await request("/api/projects", auth(adminCookie, "POST", { name: names.qaProject, group_id: "grp_qa", visibility: "group", goal_summary: "V6 production E2E", start_date: "2026-07-01", target_date: "2026-12-31", auto_archive: false }), 201);
  const projectId = projectCreate.body.id;
  assert(typeof projectId === "string", "QA project id missing");
  const internProjects = await request("/api/projects", auth(internCookie), 200);
  assert(!internProjects.body.projects.some((project) => project.id === projectId), "intern can see unassigned QA group project");
  const internPrivateRead = await request(`/api/projects/${projectId}`, auth(internCookie), 403);
  report.regression.intern_scope = { list_hidden: true, detail_status: internPrivateRead.response.status };

  const expiry = addDays("2026-07-21", 25);
  const licenseCreate = await request(`/api/projects/${projectId}/licenses`, auth(qaCookie, "POST", { name: "V6 E2E GDP License", subject: "公司", authority: "TFDA", expires_at: expiry, status: "有效", note: "production E2E" }), 201);
  const licenseList = await request(`/api/projects/${projectId}/licenses`, auth(qaCookie), 200);
  assert(licenseList.body.licenses.some((license) => license.id === licenseCreate.body.id && license.expires_at === expiry), "license readback failed");
  const dashboard = await request("/api/dashboard", auth(adminCookie), 200);
  assert(dashboard.body.v6.license_alerts.some((license) => license.id === licenseCreate.body.id), "dashboard license alert missing");
  report.qa = { license_created: true, expires_in_days: 25, dashboard_alert: true };

  await request(`/api/projects/${projectId}/quarter-goals/2026Q3`, auth(qaCookie, "PUT", { objective: "V6 E2E objective" }), 200);
  const krOne = await request(`/api/projects/${projectId}/key-results`, auth(qaCookie, "POST", { title: "V6 KR 1", owner_id: "usr_e2e_v6_qa", quarter: "2026Q3", status: "未開始" }), 201);
  await request(`/api/projects/${projectId}/key-results`, auth(qaCookie, "POST", { title: "V6 KR 2", owner_id: "usr_e2e_v6_qa", quarter: "2026Q3", status: "未開始" }), 201);
  await request(`/api/key-results/${krOne.body.id}`, auth(qaCookie, "PATCH", { status: "完成" }), 200);
  const okr = await request(`/api/projects/${projectId}/okr?quarter=2026Q3`, auth(qaCookie), 200);
  const projectAfterKr = await request(`/api/projects/${projectId}`, auth(qaCookie), 200);
  assert(okr.body.objective.objective === "V6 E2E objective" && okr.body.key_results.length === 2, "OKR readback failed");
  assert(projectAfterKr.body.project.progress === 50, `expected KR-only auto progress 50, got ${projectAfterKr.body.project.progress}`);
  report.okr = { objective: true, key_results: 2, completed: 1, auto_progress: projectAfterKr.body.project.progress };

  const ccrCreate = await request(`/api/projects/${projectId}/ccrs`, auth(qaCookie, "POST", { title: "V6 E2E 包材變更", target_type: "產品", description: "變更包材", reason: "供應商變更", classification: "重大", impact_assessment: "需確認效期" }), 201);
  assert(ccrCreate.body.ccr_no === "CCR-2026-001", `expected CCR-2026-001, got ${ccrCreate.body.ccr_no}`);
  for (const status of ["評估中", "已核准", "執行中", "效期確認", "已結案"]) await request(`/api/ccrs/${ccrCreate.body.id}/transition`, auth(qaCookie, "POST", { status, description: `E2E → ${status}` }), 200);
  const ccrs = await request(`/api/projects/${projectId}/ccrs`, auth(qaCookie), 200);
  const ccr = ccrs.body.ccrs.find((item) => item.id === ccrCreate.body.id);
  const ccrEvents = ccrs.body.events.filter((event) => event.ccr_id === ccrCreate.body.id);
  assert(ccr?.status === "已結案" && ccr.approved_at && ccr.closed_at, "CCR terminal fields missing");
  assert(ccrEvents.length === 6 && ccrEvents.map((event) => event.to_status).join(",") === "申請,評估中,已核准,執行中,效期確認,已結案", "CCR event history mismatch");
  const todos = await request("/api/todos", auth(qaCookie), 200);
  assert(todos.body.todos.some((todo) => todo.project_id === projectId && todo.title === "CCR 效期確認：V6 E2E 包材變更"), "CCR expiry todo missing");
  report.ccr = { number: ccr.ccr_no, status: ccr.status, events: ccrEvents.length, expiry_todo: true };

  const regCreate = await request("/api/regwatch", auth(raCookie, "POST", { entry_date: "2026-07-21", entry_type: "announcement", product_line: "藥品", category: "E2E", title: regTitles[0], key_points: "第一點\n第二點", link: "https://example.com/v6-e2e" }), 201);
  const internRegRead = await request("/api/regwatch", auth(internCookie), 200);
  assert(internRegRead.body.entries.some((entry) => entry.id === regCreate.body.id), "intern cannot read regwatch entry");
  const internRegWrite = await request("/api/regwatch", auth(internCookie, "POST", { entry_date: "2026-07-21", product_line: "藥品", title: "不得建立" }), 403);
  report.regwatch = { ra_member_create: true, intern_read: internRegRead.response.status, intern_write: internRegWrite.response.status };

  const importPayload = {
    projects: [{ external_key: externalKey, name: names.importProject, group: "grp_general", owner_email: emails.admin, visibility: "group", status: "active", progress: 10, goal_summary: "V6 import E2E", start_date: "2026-07-01", target_date: "2026-09-30", progress_updates: [{ date: "2026-07-20", content: "匯入進度一", author_email: emails.admin }, { date: "2026-07-21", content: "匯入進度二", author_email: emails.admin }] }],
    reg_entries: [{ entry_date: "2026-07-20", entry_type: "announcement", product_line: "藥品", title: regTitles[1], key_points: "一" }, { entry_date: "2026-07-21", entry_type: "meeting", product_line: "醫療器材", title: regTitles[2], key_points: "二" }],
  };
  const firstImport = await request("/api/admin/import", auth(adminCookie, "POST", importPayload), 200);
  assert(firstImport.body.projects.created === 1 && firstImport.body.progress_updates.created === 2 && firstImport.body.reg_entries.created === 2, "first import stats mismatch");
  const secondImport = await request("/api/admin/import", auth(adminCookie, "POST", importPayload), 200);
  assert(secondImport.body.projects.updated === 1 && secondImport.body.progress_updates.skipped === 2 && secondImport.body.reg_entries.skipped === 2, "second import stats mismatch");
  report.import = { first: firstImport.body, second: secondImport.body };
} catch (error) {
  failure = error;
} finally {
  try { runD1(cleanupSql()); report.cleanup = true; } catch (error) { report.cleanup = false; failure ??= error; }
}

if (failure) report.error = failure.message;
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
