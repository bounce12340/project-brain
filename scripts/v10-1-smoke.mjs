import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const fixtureUser = { id: "usr_e2e_v10_1_ra", email: "v10-1-ra@demo.local", name: "V10.1 Smoke RA" };
const report = { homepage: 0, unauthenticated: 0, authenticated: 0, can_manage: false, entries: 0, cleanup: false };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runD1(sql) {
  const command = spawnSync(process.execPath, [wrangler, "d1", "execute", database, "--remote", "--yes", "--command", sql, "--json"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (command.status !== 0) throw new Error("remote D1 fixture command failed");
  return JSON.parse(command.stdout).flatMap((item) => item.results ?? []);
}

function cleanupFixture() {
  const id = sqlValue(fixtureUser.id);
  runD1(`DELETE FROM sessions WHERE user_id=${id}; DELETE FROM users WHERE id=${id};`);
}

async function request(pathname, cookie) {
  const response = await fetch(`${base}${pathname}`, cookie ? { headers: { Cookie: cookie } } : {});
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

let failure;
try {
  cleanupFixture();
  const token = randomBytes(32).toString("base64url");
  const sessionId = createHash("sha256").update(token).digest("hex");
  runD1(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
    VALUES (${sqlValue(fixtureUser.id)},${sqlValue(fixtureUser.email)},${sqlValue(fixtureUser.name)},'disabled-v10-1-fixture','member','grp_general',0,0,1,1,1,'approved');
    INSERT INTO sessions (id,user_id,expires_at) VALUES (${sqlValue(sessionId)},${sqlValue(fixtureUser.id)},datetime('now','+1 hour'));`);

  const homepage = await fetch(base);
  assert(homepage.status === 200, `homepage expected 200, got ${homepage.status}`);
  report.homepage = homepage.status;

  const unauthenticated = await request("/api/regwatch");
  assert(unauthenticated.response.status === 401, `unauthenticated regwatch expected 401, got ${unauthenticated.response.status}`);
  report.unauthenticated = unauthenticated.response.status;

  const authenticated = await request("/api/regwatch", `sid=${token}`);
  assert(authenticated.response.status === 200, `authenticated regwatch expected 200, got ${authenticated.response.status}`);
  assert(authenticated.body.can_manage === true, "RA/PV fixture should receive can_manage=true");
  assert(Array.isArray(authenticated.body.entries), "regwatch response entries should be an array");
  assert(Number.isInteger(authenticated.body.total), "regwatch response total should be an integer");
  report.authenticated = authenticated.response.status;
  report.can_manage = authenticated.body.can_manage;
  report.entries = authenticated.body.total;
} catch (error) {
  failure = error;
} finally {
  try {
    cleanupFixture();
    const remaining = runD1(`SELECT
      (SELECT COUNT(*) FROM users WHERE id=${sqlValue(fixtureUser.id)}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${sqlValue(fixtureUser.id)}) AS sessions;`)[0];
    assert(remaining.users === 0 && remaining.sessions === 0, `fixture cleanup mismatch: ${JSON.stringify(remaining)}`);
    report.cleanup = true;
  } catch (error) {
    failure ??= error;
  }
}

if (failure) report.error = failure.message;
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
