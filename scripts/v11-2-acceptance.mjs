import { createHash, randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const demoUser = {
  id: "usr_e2e_v11_2_ra",
  email: "v11-2-ra@demo.local",
  name: "V11.2 Demo RA",
};
const fixture = {
  id: "reg_e2e_v11_2_rejected",
  sourceRef: "9911261202",
  title: "V11.2-E2E 合成 TFDA 駁回公告",
};
const report = {
  baseline: {},
  synthetic_delete: {},
  regression: {},
  cleanup: false,
};

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
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runD1(sql) {
  const command = wranglerCommand(["d1", "execute", database, "--remote", "--yes", "--command", sql, "--json"]);
  if (command.status !== 0) throw new Error("remote D1 command failed");
  return JSON.parse(command.stdout);
}

function queryD1(sql) {
  return runD1(sql).flatMap((item) => item.results ?? []);
}

function snapshot(where) {
  const rows = queryD1(`SELECT * FROM reg_entries WHERE ${where} ORDER BY id`);
  return {
    count: rows.length,
    fingerprint: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

function realSnapshots() {
  return {
    drafts: snapshot("source='tfda_rss' AND status='draft'"),
    published: snapshot("status='published'"),
  };
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations: 100_000,
  }, key, 256);
  return `pbkdf2$100000$${salt.toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}

async function request(pathname, options = {}, expected) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) headers.set("Origin", base);
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (expected !== undefined) {
    assert(
      response.status === expected,
      `${pathname}: expected ${expected}, got ${response.status}, body=${JSON.stringify(body)}`,
    );
  }
  return { response, body };
}

async function login(password) {
  const { response } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: demoUser.email, password }),
  }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), "missing V11.2 demo session cookie");
  return cookie;
}

function cleanupFixture() {
  const userId = sqlValue(demoUser.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM reg_entries WHERE id=${sqlValue(fixture.id)};
    DELETE FROM tfda_rejected WHERE source_ref=${sqlValue(fixture.sourceRef)};
    DELETE FROM audit_log WHERE user_id=${userId};
    DELETE FROM sessions WHERE user_id=${userId};
    DELETE FROM users WHERE id=${userId};`);
}

let failure;
let before;
try {
  cleanupFixture();
  before = realSnapshots();
  const tombstonesBefore = queryD1("SELECT COUNT(*) AS count FROM tfda_rejected")[0]?.count;
  assert(before.drafts.count === 20, `expected 20 real TFDA drafts, got ${before.drafts.count}`);
  assert(before.published.count === 631, `expected 631 published entries, got ${before.published.count}`);
  assert(tombstonesBefore === 0, `expected no prewritten real tombstones, got ${tombstonesBefore}`);
  report.baseline = { ...before, tombstones: tombstonesBefore };

  const password = randomBytes(18).toString("base64url");
  const hash = await passwordHash(password);
  runD1(`INSERT INTO users
      (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES (${sqlValue(demoUser.id)},${sqlValue(demoUser.email)},${sqlValue(demoUser.name)},${sqlValue(hash)},'member','grp_general',0,0,1,1,1,'approved');
    INSERT INTO reg_entries
      (id,entry_date,entry_type,product_line,category,title,key_points,link,created_by,status,source,source_ref)
      VALUES
      (${sqlValue(fixture.id)},'2026-07-26','announcement','其他','合成',${sqlValue(fixture.title)},'SPEC-V11-2 synthetic only','https://www.fda.gov.tw/TC/newsContent.aspx?id=${fixture.sourceRef}',${sqlValue(demoUser.id)},'draft','tfda_rss',${sqlValue(fixture.sourceRef)});`);

  const cookie = await login(password);
  const deleted = await request(`/api/regwatch/${fixture.id}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  }, 200);
  assert(deleted.body.ok === true, `synthetic delete response mismatch: ${JSON.stringify(deleted.body)}`);

  const stored = queryD1(`SELECT
    (SELECT COUNT(*) FROM reg_entries WHERE id=${sqlValue(fixture.id)}) AS entries,
    source_ref,title,rejected_by,rejected_at
    FROM tfda_rejected WHERE source_ref=${sqlValue(fixture.sourceRef)}`)[0];
  assert(stored?.entries === 0, "synthetic TFDA entry was not deleted");
  assert(stored?.source_ref === fixture.sourceRef, "synthetic tombstone source_ref mismatch");
  assert(stored?.title === fixture.title, "synthetic tombstone title mismatch");
  assert(stored?.rejected_by === demoUser.id, "synthetic tombstone rejected_by mismatch");
  assert(Boolean(stored?.rejected_at), "synthetic tombstone rejected_at missing");
  const auditCount = queryD1(`SELECT COUNT(*) AS count FROM audit_log
    WHERE user_id=${sqlValue(demoUser.id)} AND action='delete' AND entity_id=${sqlValue(fixture.id)}`)[0]?.count;
  assert(auditCount === 1, `expected one synthetic delete audit, got ${auditCount}`);
  report.synthetic_delete = {
    status: deleted.response.status,
    entry_remaining: stored.entries,
    tombstone_source_ref: stored.source_ref,
    rejected_by: stored.rejected_by,
    rejected_at_present: true,
    audit_rows: auditCount,
  };

  const unauthenticated = await request("/api/regwatch", {}, 401);
  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200, `homepage expected 200, got ${homepage.status}`);
  assert(html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const during = realSnapshots();
  assert(during.drafts.fingerprint === before.drafts.fingerprint, "real TFDA drafts changed during E2E");
  assert(during.published.fingerprint === before.published.fingerprint, "published entries changed during E2E");
  report.regression = {
    unauthenticated: unauthenticated.response.status,
    homepage: homepage.status,
    title: "艾爾水晶-專案進度",
    real_drafts_unchanged_during: true,
    published_unchanged_during: true,
  };
} catch (error) {
  failure = error;
} finally {
  try {
    cleanupFixture();
    const after = realSnapshots();
    const remaining = queryD1(`SELECT
      (SELECT COUNT(*) FROM users WHERE id=${sqlValue(demoUser.id)}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${sqlValue(demoUser.id)}) AS sessions,
      (SELECT COUNT(*) FROM reg_entries WHERE id=${sqlValue(fixture.id)}) AS entries,
      (SELECT COUNT(*) FROM tfda_rejected WHERE source_ref=${sqlValue(fixture.sourceRef)}) AS tombstones`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup mismatch: ${JSON.stringify(remaining)}`);
    if (before) {
      assert(after.drafts.count === 20, `final real TFDA draft count is ${after.drafts.count}`);
      assert(after.published.count === 631, `final published count is ${after.published.count}`);
      assert(after.drafts.fingerprint === before.drafts.fingerprint, "real TFDA draft fingerprint changed after cleanup");
      assert(after.published.fingerprint === before.published.fingerprint, "published fingerprint changed after cleanup");
    }
    const finalTombstones = queryD1("SELECT COUNT(*) AS count FROM tfda_rejected")[0]?.count;
    assert(finalTombstones === 0, `final tombstone count expected 0, got ${finalTombstones}`);
    report.regression = {
      ...report.regression,
      final_real_drafts: after.drafts.count,
      final_published: after.published.count,
      final_tombstones: finalTombstones,
      real_drafts_unchanged_after: before ? after.drafts.fingerprint === before.drafts.fingerprint : null,
      published_unchanged_after: before ? after.published.fingerprint === before.published.fingerprint : null,
    };
    report.cleanup = true;
  } catch (error) {
    failure ??= error;
  }
}

if (failure) {
  console.error(JSON.stringify(report, null, 2));
  throw failure;
}

console.log(JSON.stringify(report, null, 2));
