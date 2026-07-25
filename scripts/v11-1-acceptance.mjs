import { createHash, randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const bucket = "project-brain-files";
const demoUser = { id: "usr_e2e_v11_1_ra", email: "v11-1-ra@demo.local", name: "V11.1 Demo RA" };
const fixtures = {
  deletePlain: { id: "reg_e2e_v11_1_delete_plain", title: "V11.1-E2E 批次刪除（無附件）" },
  deleteFile: { id: "reg_e2e_v11_1_delete_file", title: "V11.1-E2E 批次刪除（孤兒附件）" },
  approve: { id: "reg_e2e_v11_1_approve", title: "V11.1-E2E 批次核准" },
};
const fileFixture = {
  id: "file_e2e_v11_1_orphan",
  name: "V11.1-E2E-synthetic.txt",
  key: "regwatch/file_e2e_v11_1_orphan/V11.1-E2E-synthetic.txt",
  bytes: Buffer.from("SPEC-V11-1 synthetic orphan attachment", "utf8"),
};
const fixtureIds = Object.values(fixtures).map((fixture) => fixture.id);
const report = { baseline: {}, batch_delete: {}, batch_approve: {}, regression: {}, cleanup: false };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function wranglerCommand(args, options = {}) {
  return spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runD1(sql) {
  const command = wranglerCommand(["d1", "execute", database, "--remote", "--yes", "--command", sql, "--json"]);
  if (command.status !== 0) throw new Error("remote D1 fixture command failed");
  return JSON.parse(command.stdout);
}

function queryD1(sql) {
  return runD1(sql).flatMap((item) => item.results ?? []);
}

function getR2Object(storageKey) {
  return wranglerCommand(["r2", "object", "get", `${bucket}/${storageKey}`, "--remote", "--pipe"], { encoding: null });
}

function putR2Object(storageKey, bytes) {
  const command = wranglerCommand(["r2", "object", "put", `${bucket}/${storageKey}`, "--remote", "--pipe"], { input: bytes });
  if (command.status !== 0) throw new Error("remote R2 fixture upload failed");
}

function deleteR2Object(storageKey) {
  return wranglerCommand(["r2", "object", "delete", `${bucket}/${storageKey}`, "--remote"]);
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
  const { response } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: demoUser.email, password }),
  }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), "missing V11.1 demo session cookie");
  return cookie;
}

function auth(cookie, method = "GET", body) {
  return { method, headers: { Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

function realDraftSnapshot() {
  const rows = queryD1(`SELECT id,source_ref,status,entry_date,title,updated_at FROM reg_entries
    WHERE source='tfda_rss' AND status='draft' ORDER BY id`);
  return {
    count: rows.length,
    fingerprint: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

function counts() {
  return queryD1(`SELECT
    SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
    SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts
    FROM reg_entries`)[0];
}

function fixtureFiles() {
  return queryD1(`SELECT id,storage_key FROM files WHERE uploaded_by=${sqlValue(demoUser.id)}`);
}

function cleanupFixtures() {
  for (const file of fixtureFiles()) deleteR2Object(file.storage_key);
  const userId = sqlValue(demoUser.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM reg_entries WHERE id IN (${fixtureIds.map(sqlValue).join(",")});
    DELETE FROM files WHERE id=${sqlValue(fileFixture.id)} OR uploaded_by=${userId};
    DELETE FROM audit_log WHERE user_id=${userId};
    DELETE FROM sessions WHERE user_id=${userId};
    DELETE FROM users WHERE id=${userId};`);
  deleteR2Object(fileFixture.key);
}

let failure;
let beforeReal;
try {
  cleanupFixtures();
  beforeReal = realDraftSnapshot();
  const beforeCounts = counts();
  assert(beforeReal.count === 20, `expected 20 real TFDA drafts before E2E, got ${beforeReal.count}`);
  assert(beforeCounts.published === 631, `expected 631 published entries before E2E, got ${beforeCounts.published}`);
  report.baseline = { real_tfda_drafts: beforeReal.count, real_tfda_fingerprint: beforeReal.fingerprint, ...beforeCounts };

  const password = randomBytes(18).toString("base64url");
  const hash = await passwordHash(password);
  runD1(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES (${sqlValue(demoUser.id)},${sqlValue(demoUser.email)},${sqlValue(demoUser.name)},${sqlValue(hash)},'member','grp_general',0,0,1,1,1,'approved');
    INSERT INTO files (id,project_id,task_id,filename,size,content_type,storage_key,uploaded_by)
      VALUES (${sqlValue(fileFixture.id)},NULL,NULL,${sqlValue(fileFixture.name)},${fileFixture.bytes.length},'text/plain',${sqlValue(fileFixture.key)},${sqlValue(demoUser.id)});
    INSERT INTO reg_entries (id,entry_date,entry_type,product_line,category,title,key_points,created_by,file_id,status,source)
      VALUES
      (${sqlValue(fixtures.deletePlain.id)},'2026-07-26','announcement','其他','合成',${sqlValue(fixtures.deletePlain.title)},'SPEC-V11-1 synthetic only',${sqlValue(demoUser.id)},NULL,'draft','manual'),
      (${sqlValue(fixtures.deleteFile.id)},'2026-07-26','announcement','其他','合成',${sqlValue(fixtures.deleteFile.title)},'SPEC-V11-1 synthetic only',${sqlValue(demoUser.id)},${sqlValue(fileFixture.id)},'draft','manual'),
      (${sqlValue(fixtures.approve.id)},'2026-07-26','announcement','其他','合成',${sqlValue(fixtures.approve.title)},'SPEC-V11-1 synthetic only',${sqlValue(demoUser.id)},NULL,'draft','manual');
    INSERT INTO reg_entry_files(entry_id,file_id,position)
      VALUES (${sqlValue(fixtures.deleteFile.id)},${sqlValue(fileFixture.id)},0);`);
  putR2Object(fileFixture.key, fileFixture.bytes);
  assert(getR2Object(fileFixture.key).status === 0, "synthetic R2 attachment missing before batch delete");
  const cookie = await login(password);

  const draftView = await request("/api/regwatch?view=drafts", auth(cookie), 200);
  assert(draftView.body.pending_count === 23, `expected pending_count 23 with fixtures, got ${draftView.body.pending_count}`);
  assert(fixtureIds.every((id) => draftView.body.entries.some((entry) => entry.id === id && entry.status === "draft")), "draft view did not contain all three synthetic fixtures");

  const deleted = await request("/api/regwatch/drafts/batch", auth(cookie, "POST", {
    action: "delete",
    ids: [fixtures.deletePlain.id, fixtures.deleteFile.id],
  }), 200);
  assert(deleted.body.processed === 2 && deleted.body.skipped === 0, `batch delete stats mismatch: ${JSON.stringify(deleted.body)}`);
  const afterDelete = queryD1(`SELECT
    (SELECT COUNT(*) FROM reg_entries WHERE id IN (${sqlValue(fixtures.deletePlain.id)},${sqlValue(fixtures.deleteFile.id)})) AS deleted_entries,
    (SELECT COUNT(*) FROM reg_entries WHERE id=${sqlValue(fixtures.approve.id)} AND status='draft') AS remaining_draft,
    (SELECT COUNT(*) FROM reg_entry_files WHERE file_id=${sqlValue(fileFixture.id)}) AS links,
    (SELECT COUNT(*) FROM files WHERE id=${sqlValue(fileFixture.id)}) AS files`)[0];
  assert(afterDelete.deleted_entries === 0 && afterDelete.remaining_draft === 1 && afterDelete.links === 0 && afterDelete.files === 0, `batch delete read-back mismatch: ${JSON.stringify(afterDelete)}`);
  assert(getR2Object(fileFixture.key).status !== 0, "orphan R2 attachment still exists after batch delete");
  report.batch_delete = { ...deleted.body, ...afterDelete, orphan_r2_objects: 0 };

  const approved = await request("/api/regwatch/drafts/batch", auth(cookie, "POST", {
    action: "approve",
    ids: [fixtures.approve.id],
  }), 200);
  assert(approved.body.processed === 1 && approved.body.skipped === 0, `batch approve stats mismatch: ${JSON.stringify(approved.body)}`);
  const stored = queryD1(`SELECT status FROM reg_entries WHERE id=${sqlValue(fixtures.approve.id)}`)[0];
  assert(stored?.status === "published", "remaining synthetic draft did not become published");
  const visible = await request(`/api/regwatch?keyword=${encodeURIComponent(fixtures.approve.title)}`, auth(cookie), 200);
  assert(visible.body.entries.some((entry) => entry.id === fixtures.approve.id && entry.status === "published"), "approved synthetic entry is not visible in published list");
  const audits = queryD1(`SELECT action,summary FROM audit_log WHERE user_id=${sqlValue(demoUser.id)} AND action='regwatch_draft_batch' ORDER BY created_at`);
  assert(audits.length === 2, `expected two batch audit rows, got ${audits.length}`);
  assert(audits.some((row) => row.summary.includes("action=delete") && row.summary.includes("processed=2")), "delete audit summary missing");
  assert(audits.some((row) => row.summary.includes("action=approve") && row.summary.includes("processed=1")), "approve audit summary missing");
  report.batch_approve = { ...approved.body, stored_status: stored.status, published_visible: true, audit_rows: audits.length };

  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200 && html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const unauthenticated = await request("/api/regwatch", {}, 401);
  const duringReal = realDraftSnapshot();
  assert(duringReal.count === beforeReal.count && duringReal.fingerprint === beforeReal.fingerprint, "real TFDA drafts changed during synthetic E2E");
  report.regression = {
    homepage: homepage.status,
    title: "艾爾水晶-專案進度",
    unauthenticated: unauthenticated.response.status,
    real_tfda_drafts_during: duringReal.count,
    real_tfda_fingerprint_unchanged_during: true,
  };
} catch (error) {
  failure = error;
} finally {
  try {
    cleanupFixtures();
    const afterReal = realDraftSnapshot();
    const afterCounts = counts();
    const remaining = queryD1(`SELECT
      (SELECT COUNT(*) FROM users WHERE id=${sqlValue(demoUser.id)}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${sqlValue(demoUser.id)}) AS sessions,
      (SELECT COUNT(*) FROM reg_entries WHERE id IN (${fixtureIds.map(sqlValue).join(",")})) AS entries,
      (SELECT COUNT(*) FROM files WHERE id=${sqlValue(fileFixture.id)}) AS files`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup read-back mismatch: ${JSON.stringify(remaining)}`);
    assert(afterReal.count === 20, `expected 20 real TFDA drafts after cleanup, got ${afterReal.count}`);
    if (beforeReal) assert(afterReal.fingerprint === beforeReal.fingerprint, "real TFDA draft fingerprint changed after cleanup");
    assert(afterCounts.published === 631 && afterCounts.drafts === 20, `final counts mismatch: ${JSON.stringify(afterCounts)}`);
    report.regression = {
      ...report.regression,
      published_after_cleanup: afterCounts.published,
      drafts_after_cleanup: afterCounts.drafts,
      real_tfda_fingerprint_unchanged_after: beforeReal ? afterReal.fingerprint === beforeReal.fingerprint : null,
    };
    report.cleanup = true;
  } catch (error) {
    failure ??= error;
  }
}

if (failure) report.error = failure.message;
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
