import { randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const raUser = { id: "usr_e2e_v11_ra", email: "v11-ra@demo.local", name: "V11 Demo RA", group: "grp_general" };
const bdUser = { id: "usr_e2e_v11_bd", email: "v11-bd@demo.local", name: "V11 Demo BD", group: "grp_bd" };
const syntheticId = "reg_e2e_v11_synthetic";
const syntheticTitle = "V11-E2E 合成審核草稿";
const report = { first_fetch: {}, real_drafts: [], synthetic: {}, second_fetch: {}, regression: {}, cleanup: false };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function wranglerCommand(args) {
  return spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runD1(sql) {
  const command = wranglerCommand(["d1", "execute", database, "--remote", "--command", sql, "--json"]);
  if (command.status !== 0) throw new Error("remote D1 fixture command failed");
  return JSON.parse(command.stdout);
}

function queryD1(sql) {
  return runD1(sql).flatMap((item) => item.results ?? []);
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

async function login(account, password) {
  const { response } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: account.email, password }),
  }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), `missing ${account.id} session cookie`);
  return cookie;
}

function auth(cookie, method = "GET", body) {
  return { method, headers: { Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

function cleanupFixtures() {
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM reg_entries WHERE id=${sqlValue(syntheticId)};
    DELETE FROM audit_log WHERE user_id IN (${sqlValue(raUser.id)},${sqlValue(bdUser.id)});
    DELETE FROM sessions WHERE user_id IN (${sqlValue(raUser.id)},${sqlValue(bdUser.id)});
    DELETE FROM users WHERE id IN (${sqlValue(raUser.id)},${sqlValue(bdUser.id)});`);
}

let failure;
try {
  cleanupFixtures();
  const [raPassword, bdPassword] = [randomBytes(18).toString("base64url"), randomBytes(18).toString("base64url")];
  const [raHash, bdHash] = await Promise.all([passwordHash(raPassword), passwordHash(bdPassword)]);
  runD1(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES (${sqlValue(raUser.id)},${sqlValue(raUser.email)},${sqlValue(raUser.name)},${sqlValue(raHash)},'member',${sqlValue(raUser.group)},0,0,1,1,1,'approved');
    INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES (${sqlValue(bdUser.id)},${sqlValue(bdUser.email)},${sqlValue(bdUser.name)},${sqlValue(bdHash)},'member',${sqlValue(bdUser.group)},0,0,1,1,1,'approved');`);
  const [raCookie, bdCookie] = await Promise.all([login(raUser, raPassword), login(bdUser, bdPassword)]);

  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200 && html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const unauthenticated = await request("/api/regwatch", {}, 401);
  const before = queryD1(`SELECT
    SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
    SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts
    FROM reg_entries`)[0];

  const first = await request("/api/regwatch/tfda-fetch", auth(raCookie, "POST"), 200);
  assert(typeof first.body.new_drafts === "number", "first TFDA fetch did not return stats");
  report.first_fetch = first.body;
  report.real_drafts = queryD1(`SELECT id,source_ref,entry_date,title FROM reg_entries
    WHERE source='tfda_rss' AND status='draft' ORDER BY entry_date DESC,created_at DESC`);
  const afterFirst = queryD1(`SELECT
    SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
    SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts
    FROM reg_entries`)[0];
  assert(afterFirst.drafts - before.drafts === first.body.new_drafts, `draft delta ${afterFirst.drafts - before.drafts} differs from new_drafts ${first.body.new_drafts}`);

  const publishedList = await request("/api/regwatch", auth(raCookie), 200);
  assert(publishedList.body.view === "published", "default regwatch view is not published");
  assert(publishedList.body.total === afterFirst.published, `published API total ${publishedList.body.total} differs from D1 ${afterFirst.published}`);
  assert(publishedList.body.entries.every((entry) => entry.status === "published"), "default list leaked a draft");

  const bdDraftAttempt = await request("/api/regwatch?view=drafts", auth(bdCookie), 200);
  assert(bdDraftAttempt.body.view === "published", "BD member entered draft view");
  assert(bdDraftAttempt.body.total === afterFirst.published, "BD member total differs from published count");
  assert(bdDraftAttempt.body.entries.every((entry) => entry.status === "published"), "BD member saw a draft");
  await request("/api/regwatch/tfda-fetch", auth(bdCookie, "POST"), 403);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  runD1(`INSERT INTO reg_entries
    (id,entry_date,entry_type,product_line,category,title,key_points,link,created_by,status,source,source_ref)
    VALUES (${sqlValue(syntheticId)},${sqlValue(today)},'announcement','其他','合成',${sqlValue(syntheticTitle)},'僅供 V11 核准流程驗收',NULL,${sqlValue(raUser.id)},'draft','manual',NULL);`);
  const draftView = await request("/api/regwatch?view=drafts", auth(raCookie), 200);
  assert(draftView.body.entries.some((entry) => entry.id === syntheticId && entry.status === "draft"), "RA draft view did not show synthetic fixture");
  const bdAfterSynthetic = await request("/api/regwatch?view=drafts", auth(bdCookie), 200);
  assert(!bdAfterSynthetic.body.entries.some((entry) => entry.id === syntheticId), "BD member saw synthetic draft");

  await request(`/api/regwatch/${syntheticId}/approve`, auth(raCookie, "POST"), 200);
  const approved = queryD1(`SELECT status FROM reg_entries WHERE id=${sqlValue(syntheticId)}`)[0];
  assert(approved?.status === "published", "synthetic fixture did not become published");
  const visible = await request(`/api/regwatch?keyword=${encodeURIComponent(syntheticTitle)}`, auth(bdCookie), 200);
  assert(visible.body.entries.some((entry) => entry.id === syntheticId && entry.status === "published"), "approved synthetic fixture is not visible in general list");
  await request(`/api/regwatch/${syntheticId}`, auth(raCookie, "DELETE"), 200);
  assert(queryD1(`SELECT COUNT(*) AS value FROM reg_entries WHERE id=${sqlValue(syntheticId)}`)[0]?.value === 0, "synthetic fixture cleanup failed");
  report.synthetic = { draft_visible_to_ra: true, draft_hidden_from_bd: true, approved: true, published_visible_to_bd: true, cleaned: true };

  const second = await request("/api/regwatch/tfda-fetch", auth(raCookie, "POST"), 200);
  assert(second.body.new_drafts === 0, `second fetch created ${second.body.new_drafts} drafts`);
  report.second_fetch = second.body;

  const finalCounts = queryD1(`SELECT
    SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
    SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts
    FROM reg_entries`)[0];
  const finalList = await request("/api/regwatch", auth(bdCookie), 200);
  assert(finalList.body.total === finalCounts.published, "final general list total differs from published count");
  report.regression = {
    homepage: homepage.status,
    title: true,
    unauthenticated: unauthenticated.response.status,
    published_count: finalCounts.published,
    general_list_total: finalList.body.total,
    drafts_preserved: finalCounts.drafts,
    bd_draft_view: bdDraftAttempt.body.view,
    bd_tfda_fetch: 403,
  };
} catch (error) {
  failure = error;
} finally {
  try {
    cleanupFixtures();
    const remaining = queryD1(`SELECT
      (SELECT COUNT(*) FROM users WHERE id IN (${sqlValue(raUser.id)},${sqlValue(bdUser.id)})) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id IN (${sqlValue(raUser.id)},${sqlValue(bdUser.id)})) AS sessions,
      (SELECT COUNT(*) FROM reg_entries WHERE id=${sqlValue(syntheticId)}) AS synthetic_entries`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup read-back mismatch: ${JSON.stringify(remaining)}`);
    report.cleanup = true;
  } catch (error) {
    failure ??= error;
  }
}

if (failure) report.error = failure.message;
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
