import { randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const bucket = "project-brain-files";
const demoUser = { id: "usr_e2e_v10_ra", email: "v10-ra@demo.local", name: "V10 Demo RA" };
const marker = "V10-E2E-20260723";
const report = { regression: {}, announced_date: {}, multi_file: {}, deletion: {}, cleanup: false };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function wranglerCommand(args, encoding = "utf8") {
  return spawnSync(process.execPath, [wrangler, ...args], { cwd: root, encoding, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
}

function runD1(sql) {
  const command = wranglerCommand(["d1", "execute", database, "--remote", "--yes", "--command", sql, "--json"]);
  if (command.status !== 0) throw new Error("remote D1 fixture command failed");
  return JSON.parse(command.stdout);
}

function queryD1(sql) {
  const output = runD1(sql);
  return output.flatMap((item) => item.results ?? []);
}

function getR2Object(storageKey) {
  return wranglerCommand(["r2", "object", "get", `${bucket}/${storageKey}`, "--remote", "--pipe"], null);
}

function deleteR2Object(storageKey) {
  const command = wranglerCommand(["r2", "object", "delete", `${bucket}/${storageKey}`, "--remote"]);
  if (command.status !== 0) throw new Error(`R2 cleanup failed for fixture object ${storageKey}`);
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `pbkdf2$100000$${salt.toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}

async function request(pathname, options = {}, expected) {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) headers.set("Origin", base);
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (expected !== undefined) assert(response.status === expected, `${pathname}: expected ${expected}, got ${response.status}, body=${JSON.stringify(body)}`);
  return { response, body };
}

async function download(pathname, cookie) {
  const response = await fetch(`${base}${pathname}`, { headers: { Cookie: cookie } });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(response.status === 200, `${pathname}: download returned ${response.status}`);
  return bytes;
}

async function login(password) {
  const { response } = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: demoUser.email, password }) }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), "missing V10 demo session cookie");
  return cookie;
}

function auth(cookie, method = "GET", body) {
  return { method, headers: { Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

function fixtureFiles() {
  return queryD1(`SELECT id,storage_key FROM files WHERE uploaded_by=${sqlValue(demoUser.id)} ORDER BY id`);
}

function cleanupFixture() {
  for (const file of fixtureFiles()) deleteR2Object(file.storage_key);
  const id = sqlValue(demoUser.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM reg_entries WHERE created_by=${id};
    DELETE FROM files WHERE uploaded_by=${id};
    DELETE FROM audit_log WHERE user_id=${id};
    DELETE FROM sessions WHERE user_id=${id};
    DELETE FROM users WHERE id=${id};`);
}

function assertAnnouncedSort(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    assert(previous.entry_date > current.entry_date || (previous.entry_date === current.entry_date && previous.created_at >= current.created_at), `regwatch order failed at ${previous.id}/${current.id}`);
  }
}

let failure;
try {
  cleanupFixture();
  const password = randomBytes(18).toString("base64url");
  const hash = await passwordHash(password);
  runD1(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
    VALUES (${sqlValue(demoUser.id)},${sqlValue(demoUser.email)},${sqlValue(demoUser.name)},${sqlValue(hash)},'member','grp_general',0,0,1,1,1,'approved');`);
  const cookie = await login(password);

  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200 && html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const unauthenticated = await request("/api/regwatch", {}, 401);
  const baseline = await request("/api/regwatch", auth(cookie), 200);
  assertAnnouncedSort(baseline.body.entries);
  report.regression = {
    homepage: homepage.status,
    title: true,
    unauthenticated: unauthenticated.response.status,
    expected_regwatch: 628,
    regwatch_before: baseline.body.total,
    announced_sort: true,
  };

  const dateBytes = Buffer.from(`公告日期：民國115年7月20日。\n公告標題：${marker} 醫療器材規費公告。\n本公告調整醫療器材審查規費，自民國116年3月1日施行。`, "utf8");
  const dateForm = new FormData();
  dateForm.append("files", new File([dateBytes], `${marker}-date.txt`, { type: "text/plain" }));
  dateForm.set("mode", "single");
  const dateExtract = await request("/api/regwatch/ai-extract", { method: "POST", headers: { Cookie: cookie }, body: dateForm }, 200);
  assert(dateExtract.body.entries?.length === 1, "announced-date extract did not return one entry");
  const dateEntry = dateExtract.body.entries[0];
  const bullets = String(dateEntry.key_points ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("•"));
  assert(dateEntry.entry_date === "2026-07-20", `expected announced date 2026-07-20, got ${dateEntry.entry_date}`);
  assert(bullets[0] === "• 施行日：2027-03-01", `effective-date first bullet mismatch: ${bullets[0]}`);
  assert(dateEntry.date_suspect === false, `date_suspect expected false, got ${dateEntry.date_suspect}`);
  report.announced_date = { status: dateExtract.response.status, entries: 1, entry_date: dateEntry.entry_date, first_bullet: bullets[0], date_suspect: dateEntry.date_suspect };

  const mainBytes = Buffer.from(`公告日期：民國115年7月23日。\n文號：衛授食字第115V100001號。\n公告標題：${marker} 醫療器材管理辦法修正公告。\n立法目的：提升申報效率並強化文件追溯。`, "utf8");
  const comparisonBytes = Buffer.from(`修正條文對照表\n第3條：現行條文為申請人以紙本申報；修正條文為申請人應以線上系統申報。\n第5條：現行條文為紀錄保存三年；修正條文為紀錄保存五年。`, "utf8");
  const extractForm = new FormData();
  extractForm.append("files", new File([mainBytes], `${marker}-main.txt`, { type: "text/plain" }));
  extractForm.append("files", new File([comparisonBytes], `${marker}-comparison.txt`, { type: "text/plain" }));
  extractForm.set("mode", "single");
  const extracted = await request("/api/regwatch/ai-extract", { method: "POST", headers: { Cookie: cookie }, body: extractForm }, 200);
  assert(extracted.body.entries?.length === 1, "multi-file package did not consolidate to one entry");
  const packageEntry = extracted.body.entries[0];
  assert(String(packageEntry.key_points).includes("修正重點（前後對照）"), "comparison section heading missing");
  assert(/第\s*3\s*條.*→/.test(packageEntry.key_points), "article 3 old-to-new summary missing");
  assert(/第\s*5\s*條.*→/.test(packageEntry.key_points), "article 5 old-to-new summary missing");

  const batchForm = new FormData();
  batchForm.set("entries", JSON.stringify([packageEntry]));
  batchForm.append("files", new File([mainBytes], `${marker}-main.txt`, { type: "text/plain" }));
  batchForm.append("files", new File([comparisonBytes], `${marker}-comparison.txt`, { type: "text/plain" }));
  const batch = await request("/api/regwatch/batch", { method: "POST", headers: { Cookie: cookie }, body: batchForm }, 200);
  assert(batch.body.created === 1 && batch.body.skipped === 0, `multi-file batch stats mismatch: ${JSON.stringify(batch.body)}`);
  assert(batch.body.entry_ids?.length === 1 && batch.body.file_ids?.length === 2, "batch did not return one entry and two files");
  const entryId = batch.body.entry_ids[0];
  const fileIds = batch.body.file_ids;
  const entryPage = await request("/api/regwatch", auth(cookie), 200);
  const stored = entryPage.body.entries.find((entry) => entry.id === entryId);
  assert(stored?.files?.length === 2, `stored entry expected 2 attachments, got ${stored?.files?.length}`);
  const expectedByName = new Map([[`${marker}-main.txt`, mainBytes], [`${marker}-comparison.txt`, comparisonBytes]]);
  for (const file of stored.files) {
    const expected = expectedByName.get(file.filename);
    assert(expected, `unexpected stored filename ${file.filename}`);
    assert((await download(`/api/files/${file.id}/download`, cookie)).equals(expected), `download bytes differ for ${file.filename}`);
  }
  const junctionBefore = queryD1(`SELECT COUNT(*) AS value FROM reg_entry_files WHERE entry_id=${sqlValue(entryId)}`)[0]?.value;
  assert(junctionBefore === 2, `junction count expected 2, got ${junctionBefore}`);
  const storageRows = queryD1(`SELECT id,storage_key FROM files WHERE id IN (${fileIds.map(sqlValue).join(",")}) ORDER BY id`);
  assert(storageRows.length === 2, "D1 files read-back expected 2");
  for (const row of storageRows) assert(getR2Object(row.storage_key).status === 0, `R2 object missing before deletion: ${row.id}`);
  report.multi_file = { extract_status: extracted.response.status, entries: 1, comparison_heading: true, old_to_new_items: 2, created: batch.body.created, junction_files: junctionBefore, downloads_equal: 2 };

  const deleted = await request(`/api/regwatch/${entryId}`, auth(cookie, "DELETE"), 200);
  assert(deleted.body.deleted_files === 2, `delete expected 2 orphan files, got ${deleted.body.deleted_files}`);
  const afterDelete = queryD1(`SELECT
    (SELECT COUNT(*) FROM reg_entries WHERE id=${sqlValue(entryId)}) AS entries,
    (SELECT COUNT(*) FROM reg_entry_files WHERE entry_id=${sqlValue(entryId)}) AS links,
    (SELECT COUNT(*) FROM files WHERE id IN (${fileIds.map(sqlValue).join(",")})) AS files`)[0];
  assert(afterDelete.entries === 0 && afterDelete.links === 0 && afterDelete.files === 0, `D1 cleanup mismatch: ${JSON.stringify(afterDelete)}`);
  for (const row of storageRows) assert(getR2Object(row.storage_key).status !== 0, `R2 object still exists after deletion: ${row.id}`);
  report.deletion = { api_deleted_files: deleted.body.deleted_files, d1_entries: afterDelete.entries, d1_links: afterDelete.links, d1_files: afterDelete.files, r2_objects: 0 };

  const after = await request("/api/regwatch", auth(cookie), 200);
  assert(after.body.total === baseline.body.total, `regwatch count changed from ${baseline.body.total} to ${after.body.total}`);
  report.regression.regwatch_after = after.body.total;
  report.regression.unchanged = true;
  report.regression.expected_match = baseline.body.total === 628;
  if (baseline.body.total !== 628) throw new Error(`expected 628 existing regwatch entries, got ${baseline.body.total}`);
} catch (error) {
  failure = error;
} finally {
  try {
    cleanupFixture();
    const remaining = queryD1(`SELECT
      (SELECT COUNT(*) FROM users WHERE id=${sqlValue(demoUser.id)}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${sqlValue(demoUser.id)}) AS sessions,
      (SELECT COUNT(*) FROM reg_entries WHERE created_by=${sqlValue(demoUser.id)}) AS entries,
      (SELECT COUNT(*) FROM files WHERE uploaded_by=${sqlValue(demoUser.id)}) AS files`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup read-back mismatch: ${JSON.stringify(remaining)}`);
    report.cleanup = true;
  } catch (error) {
    failure ??= error;
  }
}

if (failure) report.error = failure.message;
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
