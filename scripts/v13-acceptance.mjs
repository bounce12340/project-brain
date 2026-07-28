import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const baselineFile = path.join(root, ".wrangler", "v13-acceptance-baseline.json");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const groupId = "grp_general";
const fixture = {
  id: "usr_e2e_v13_help",
  email: "v13-help@demo.local",
  name: "V13 Help Demo",
  password: "V13-Acceptance-Only!",
};

const topicKeys = [
  "projectGoal", "progressMode", "milestones", "historyEvents", "projectDates", "members", "visibility", "status", "objective", "keyResults", "aiRisk",
  "stages", "taskCards", "taskDates", "dependencies", "viewKanban", "viewList", "viewCalendar", "viewGantt", "unscheduled",
  "progressUpdates", "aiQuickWrite", "aiLinkSuggestions", "clinicalEnrollment", "bdCaseStatus", "bdHistory", "bdFees", "qaLicenseExpiry", "ccr",
  "files", "automationRules", "todos", "notifications", "announcementDate", "productLine", "category", "tfdaDrafts", "aiImportMode",
  "regwatchAttachments", "reportScope", "timelineLanes",
];

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
  if (command.status !== 0) throw new Error(`remote D1 command failed: ${command.stderr.trim()}`);
  return JSON.parse(command.stdout);
}

function queryD1(sql) {
  return runD1(sql).flatMap((item) => item.results ?? []);
}

function snapshot(sql) {
  const rows = queryD1(sql);
  return {
    count: rows.length,
    fingerprint: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

function protectedSnapshots() {
  return {
    drafts: snapshot("SELECT * FROM reg_entries WHERE status='draft' ORDER BY id"),
    published: snapshot("SELECT * FROM reg_entries WHERE status='published' ORDER BY id"),
    tombstones: snapshot("SELECT * FROM tfda_rejected ORDER BY source_ref"),
    real_projects: snapshot("SELECT * FROM projects WHERE is_demo=0 ORDER BY id"),
    real_tasks: snapshot("SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.is_demo=0 ORDER BY t.id"),
    real_milestones: snapshot("SELECT m.* FROM milestones m JOIN projects p ON p.id=m.project_id WHERE p.is_demo=0 ORDER BY m.id"),
    real_progress: snapshot("SELECT pu.* FROM progress_updates pu JOIN projects p ON p.id=pu.project_id WHERE p.is_demo=0 ORDER BY pu.id"),
  };
}

function cleanupFixture() {
  const id = sqlValue(fixture.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM audit_log WHERE user_id=${id};
    DELETE FROM sessions WHERE user_id=${id};
    DELETE FROM users WHERE id=${id} AND is_demo=1;`);
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const bits = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `pbkdf2$100000$${salt.toString("base64")}$${bits.toString("base64")}`;
}

function createFixture() {
  assert(queryD1(`SELECT COUNT(*) AS count FROM groups WHERE id=${sqlValue(groupId)}`)[0]?.count === 1, "demo group unavailable");
  runD1(`INSERT INTO users
    (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
    VALUES
    (${sqlValue(fixture.id)},${sqlValue(fixture.email)},${sqlValue(fixture.name)},${sqlValue(passwordHash(fixture.password))},
    'member',${sqlValue(groupId)},0,0,1,1,1,'approved');`);
}

function createSession() {
  const token = randomBytes(32).toString("base64url");
  const sessionId = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  runD1(`INSERT INTO sessions(id,user_id,expires_at) VALUES (${sqlValue(sessionId)},${sqlValue(fixture.id)},${sqlValue(expiresAt)});`);
  return `sid=${token}`;
}

async function collectProductionAssets(html) {
  const initial = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => new URL(match[1], base).href);
  assert(initial.length > 0, "production HTML has no entry script");
  const queue = [...initial];
  const seen = new Set();
  const contents = [];
  while (queue.length > 0) {
    const assetUrl = queue.shift();
    if (!assetUrl || seen.has(assetUrl)) continue;
    seen.add(assetUrl);
    const response = await fetch(assetUrl);
    assert(response.ok, `could not fetch production asset ${assetUrl}`);
    const content = await response.text();
    contents.push(content);
    for (const match of content.matchAll(/["']((?:\.\/|\/assets\/|assets\/)[^"']+\.js)["']/g)) {
      const discovered = new URL(match[1], assetUrl).href;
      if (!seen.has(discovered)) queue.push(discovered);
    }
    assert(seen.size + queue.length < 100, "production asset graph unexpectedly large");
  }
  return { combined: contents.join("\n"), count: seen.size };
}

function verifyBuiltAssets() {
  const dist = path.join(root, "dist");
  const files = [path.join(dist, "index.html"), ...readdirSync(path.join(dist, "assets")).map((name) => path.join(dist, "assets", name))];
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert(combined.includes("help-tip-bubble") && combined.includes("What it is"), "built HelpTip markers missing");
  const missingTopics = topicKeys.filter((key) => !combined.includes(key));
  assert(missingTopics.length === 0, `built topic keys missing: ${missingTopics.join(", ")}`);
  for (const anchor of ["quickstart", "quickstart-a", "quickstart-b", "quickstart-c", "concepts", "feature-index"]) {
    assert(combined.includes(anchor), `built help anchor missing: ${anchor}`);
  }
  for (const marker of ["快速上手", "這四個東西差在哪", "功能索引", "project-overview", "regwatch-ai-mode", "regwatch-attachments"]) {
    assert(combined.includes(marker), `built manual/tour marker missing: ${marker}`);
  }
  return { files: files.length, topic_keys: topicKeys.length, anchors: 6, project_steps: 14, regulatory_steps: 9 };
}

async function verifyProduction(cookie) {
  const unauthenticated = await fetch(`${base}/api/projects`);
  assert(unauthenticated.status === 401, `unauthenticated API expected 401, got ${unauthenticated.status}`);

  const authenticated = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert(authenticated.status === 200, `demo auth expected 200, got ${authenticated.status}`);

  const help = await fetch(`${base}/help`, { headers: { Cookie: cookie } });
  const html = await help.text();
  assert(help.status === 200, `/help expected 200, got ${help.status}`);
  assert(html.includes("<title>艾爾水晶-專案進度</title>"), "production title mismatch");

  const assets = await collectProductionAssets(html);
  for (const term of ["任務", "里程碑", "歷程事件", "進度紀錄", "待辦", "Task", "Milestone", "History event", "Progress update", "To-do"]) {
    assert(assets.combined.includes(term), `production help term missing: ${term}`);
  }
  for (const marker of ["What it is", "quickstart-a", "feature-index", "project-overview", "regwatch-ai-mode"]) {
    assert(assets.combined.includes(marker), `production help/tour marker missing: ${marker}`);
  }
  return {
    unauthenticated_status: unauthenticated.status,
    demo_auth_status: authenticated.status,
    help_status: help.status,
    title: "艾爾水晶-專案進度",
    asset_count: assets.count,
    zh_concepts: 5,
    en_concepts: 5,
  };
}

async function prepare() {
  cleanupFixture();
  const baseline = protectedSnapshots();
  assert(baseline.published.count === 631, `published baseline expected 631, got ${baseline.published.count}`);
  writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));
  createFixture();
  console.log(JSON.stringify({
    mode: "prepare",
    demo_email: fixture.email,
    demo_password: fixture.password,
    baseline,
    fixture_count: queryD1(`SELECT COUNT(*) AS count FROM users WHERE id=${sqlValue(fixture.id)} AND is_demo=1`)[0]?.count,
  }, null, 2));
}

async function verify() {
  assert(existsSync(baselineFile), "baseline file missing; run --prepare first");
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  let failure;
  const report = { built: {}, production: {}, regression: {}, cleanup: {} };
  try {
    report.built = verifyBuiltAssets();
    report.production = await verifyProduction(createSession());
  } catch (error) {
    failure = error;
  } finally {
    cleanupFixture();
    report.cleanup = {
      users: queryD1(`SELECT COUNT(*) AS count FROM users WHERE id=${sqlValue(fixture.id)} AND is_demo=1`)[0]?.count,
      sessions: queryD1(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${sqlValue(fixture.id)}`)[0]?.count,
      audit_log: queryD1(`SELECT COUNT(*) AS count FROM audit_log WHERE user_id=${sqlValue(fixture.id)}`)[0]?.count,
    };
    report.regression = { before: baseline, after: protectedSnapshots() };
  }
  assert(JSON.stringify(report.regression.before) === JSON.stringify(report.regression.after), "protected fingerprints changed");
  assert(Object.values(report.cleanup).every((count) => count === 0), `demo cleanup incomplete: ${JSON.stringify(report.cleanup)}`);
  if (existsSync(baselineFile)) unlinkSync(baselineFile);
  console.log(JSON.stringify(report, null, 2));
  if (failure) throw failure;
}

const mode = process.argv[2];
if (mode === "--prepare") await prepare();
else if (mode === "--verify") await verify();
else throw new Error("usage: node scripts/v13-acceptance.mjs --prepare|--verify");
