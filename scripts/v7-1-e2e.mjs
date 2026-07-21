import { randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const demoUser = {
  id: "usr_e2e_v71_ra",
  email: "v71-ra@demo.local",
  name: "V7.1 Demo RA",
};
const report = { single: {}, multi: {}, regression: {}, cleanup: false };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runD1(sql) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "project-brain-db", "--remote", "--command", sql], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("remote D1 command failed");
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

async function login(password) {
  const { response } = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: demoUser.email, password }) }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), "missing demo session cookie");
  return cookie;
}

function auth(cookie, method = "GET", body) {
  return { method, headers: { Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

function cleanupDemoUser() {
  const id = sqlValue(demoUser.id);
  runD1(`DELETE FROM audit_log WHERE user_id=${id}; DELETE FROM sessions WHERE user_id=${id}; DELETE FROM users WHERE id=${id};`);
}

let failure;
try {
  cleanupDemoUser();
  const password = randomBytes(18).toString("base64url");
  const hash = await passwordHash(password);
  runD1(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status) VALUES (${sqlValue(demoUser.id)},${sqlValue(demoUser.email)},${sqlValue(demoUser.name)},${sqlValue(hash)},'member','grp_general',0,0,1,1,1,'approved');`);
  const cookie = await login(password);

  const unauthenticated = await request("/api/regwatch", {}, 401);
  const baseline = await request("/api/regwatch", auth(cookie), 200);
  const expectedBaseline = baseline.body.total === 627;
  report.regression = { unauthenticated: unauthenticated.response.status, expected_regwatch: 627, regwatch_before: baseline.body.total, expected_baseline: expectedBaseline };

  const singleText = `這是一則獨立公告。發文日期：民國115年7月21日。文號：衛授食字第1157100001號。公告標題：V71 單則醫療器材標示修正公告。內容摘要：修正醫療器材標示與追溯要求。本公告只有下列三個修正項目，除這三項外沒有其他項目：一、外盒新增製造批號；二、說明書新增保存條件；三、植入物新增追溯碼。`;
  const single = await request("/api/regwatch/ai-extract", auth(cookie, "POST", { text: singleText, mode: "single" }), 200);
  assert(Array.isArray(single.body.entries) && single.body.entries.length === 1, `single mode expected 1 entry, got ${single.body.entries?.length}`);
  const singleEntry = single.body.entries[0];
  const keyPointLines = String(singleEntry.key_points ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert(keyPointLines.length === 4, `single key_points expected 4 lines, got ${keyPointLines.length}`);
  assert(!keyPointLines[0].startsWith("•"), "single key_points summary must not start with bullet");
  assert(keyPointLines.slice(1).every((line) => /^•\s*\S/.test(line)), "single key_points items must use bullet markers");
  report.single = { entries: single.body.entries.length, summary_lines: 1, bullet_items: keyPointLines.length - 1 };

  const multiText = `以下包含兩則獨立公告。\n\n第一則公告：發文日期民國115年7月22日，文號衛授食字第1157100002號，公告標題「V71 藥品安定性資料公告」。本公告修正申請資料須附安定性摘要。\n\n第二則公告：發文日期民國115年7月23日，文號衛授食字第1157100003號，公告標題「V71 醫療器材回收公告」。本公告要求回收通報須附批號清單。`;
  const multi = await request("/api/regwatch/ai-extract", auth(cookie, "POST", { text: multiText, mode: "multi" }), 200);
  assert(Array.isArray(multi.body.entries) && multi.body.entries.length === 2, `multi mode expected 2 entries, got ${multi.body.entries?.length}`);
  const dates = multi.body.entries.map((entry) => entry.entry_date).sort();
  assert(JSON.stringify(dates) === JSON.stringify(["2026-07-22", "2026-07-23"]), `multi dates mismatch: ${JSON.stringify(dates)}`);
  report.multi = { entries: multi.body.entries.length, dates };

  const after = await request("/api/regwatch", auth(cookie), 200);
  assert(after.body.total === baseline.body.total, `regwatch count changed from ${baseline.body.total} to ${after.body.total}`);
  report.regression.regwatch_after = after.body.total;
  report.regression.unchanged_during_e2e = true;
  if (!expectedBaseline) throw new Error(`expected 627 existing entries, got ${baseline.body.total}`);
} catch (error) {
  failure = error;
} finally {
  try {
    cleanupDemoUser();
    report.cleanup = true;
  } catch (error) {
    failure ??= error;
  }
}

if (failure) report.error = failure.message;
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
