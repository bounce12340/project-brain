import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const database = "project-brain-db";
const base = "https://projects.uic-ai.com";
const baselineFile = path.join(root, ".wrangler", "v13-2-acceptance-baseline.json");
const stateFile = path.join(root, ".wrangler", "v13-2-acceptance-state.json");
const groupId = "grp_general";
const fixture = {
  id: "usr_e2e_v13_2",
  email: "v13-2-e2e@demo.local",
  name: "V13.2 Gantt Demo",
  password: "V13.2-Acceptance-Only!",
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
    published: snapshot("SELECT * FROM reg_entries WHERE status='published' ORDER BY id"),
    drafts: snapshot("SELECT * FROM reg_entries WHERE status='draft' ORDER BY id"),
    tombstones: snapshot("SELECT * FROM tfda_rejected ORDER BY source_ref"),
    real_projects: snapshot("SELECT * FROM projects WHERE is_demo=0 ORDER BY id"),
    real_tasks: snapshot("SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.is_demo=0 ORDER BY t.id"),
    real_milestones: snapshot("SELECT m.id,m.project_id,m.title,m.due_date,m.done,m.done_at,m.position,m.kind FROM milestones m JOIN projects p ON p.id=m.project_id WHERE p.is_demo=0 ORDER BY m.id"),
    real_progress: snapshot("SELECT pu.* FROM progress_updates pu JOIN projects p ON p.id=pu.project_id WHERE p.is_demo=0 ORDER BY pu.id"),
  };
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const bits = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `pbkdf2$100000$${salt.toString("base64")}$${bits.toString("base64")}`;
}

function cleanupFixtureRows() {
  const userId = sqlValue(fixture.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM audit_log WHERE user_id=${userId};
    DELETE FROM projects WHERE owner_id=${userId} AND is_demo=1;
    DELETE FROM sessions WHERE user_id=${userId};
    DELETE FROM users WHERE id=${userId} AND is_demo=1;`);
}

function createFixture() {
  assert(queryD1(`SELECT COUNT(*) AS count FROM groups WHERE id=${sqlValue(groupId)}`)[0]?.count === 1, "demo group unavailable");
  runD1(`INSERT INTO users
    (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
    VALUES
    (${sqlValue(fixture.id)},${sqlValue(fixture.email)},${sqlValue(fixture.name)},${sqlValue(passwordHash(fixture.password))},
    'member',${sqlValue(groupId)},0,0,1,1,1,'approved');`);
}

async function login() {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email: fixture.email, password: fixture.password }),
  });
  if (response.status !== 200) {
    const errorBody = await response.text();
    throw new Error(`demo login expected 200, got ${response.status}: ${errorBody}`);
  }
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "demo login did not return a session cookie");
  return cookie;
}

async function api(cookie, pathname, options = {}) {
  const response = await fetch(`${base}/api${pathname}`, {
    ...options,
    headers: {
      Cookie: cookie,
      Origin: base,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function verifyBuiltAssets() {
  const dist = path.join(root, "dist");
  const files = [path.join(dist, "index.html"), ...readdirSync(path.join(dist, "assets")).map((name) => path.join(dist, "assets", name))];
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const markers = [
    "data-gantt-time-font-size", "data-gantt-time-font-weight", "data-gantt-label-font-size", "data-gantt-label-width",
    "data-gantt-done-pattern", "data-gantt-overdue-end", "data-gantt-milestone-period", "data-gantt-event-period",
    "gantt-month-label", "gantt-week-label",
  ];
  for (const marker of markers) assert(combined.includes(marker), `built Gantt marker missing: ${marker}`);
  for (const label of ["里程碑期間", "歷程期間", "完成（斜紋）", "逾期（紅端標）"]) {
    assert(combined.includes(label), `built legend label missing: ${label}`);
  }
  assert(combined.includes("14") && combined.includes("600") && combined.includes("210"), "built typography values missing");
  return { files: files.length, markers: markers.length, time_font_size: 14, time_font_weight: 600, label_font_size: 14, project_label_width: 210 };
}

function verifyMigration() {
  const schema = queryD1("SELECT sql FROM sqlite_master WHERE type='table' AND name='milestones'");
  const columns = queryD1("PRAGMA table_info(milestones)");
  const migrations = wranglerCommand(["d1", "migrations", "list", database, "--remote"]);
  assert(migrations.status === 0, `migration list failed: ${migrations.stderr.trim()}`);
  assert(schema.length === 1 && /\bend_date\s+TEXT\b/.test(schema[0].sql), "sqlite_master milestones SQL does not contain end_date TEXT");
  assert(columns.some((column) => column.name === "end_date" && column.type === "TEXT"), "PRAGMA table_info does not contain end_date TEXT");
  assert(migrations.stdout.includes("No migrations to apply"), `remote migration is still pending: ${migrations.stdout.trim()}`);
  return { sqlite_master_sql: schema[0].sql, end_date_column: columns.find((column) => column.name === "end_date"), migrations: "No migrations to apply" };
}

async function prepareE2e() {
  assert(existsSync(baselineFile), "baseline missing; run --snapshot before migration");
  cleanupFixtureRows();
  createFixture();
  const cookie = await login();

  const createdProject = await api(cookie, "/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "V13.2 期間甘特 Demo",
      group_id: groupId,
      visibility: "private",
      start_date: "2026-02-01",
      target_date: "2026-09-30",
      auto_archive: false,
    }),
  });
  assert(createdProject.response.status === 201 && typeof createdProject.body.id === "string", `project create failed: ${JSON.stringify(createdProject.body)}`);
  const projectId = createdProject.body.id;
  runD1(`UPDATE projects SET is_demo=1 WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(fixture.id)};`);
  assert(queryD1(`SELECT COUNT(*) AS count FROM projects WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(fixture.id)} AND is_demo=1`)[0]?.count === 1, "project was not marked as demo");

  const stage = await api(cookie, `/projects/${projectId}/stages`, {
    method: "POST",
    body: JSON.stringify({ name: "審查", color: "#8b5cf6" }),
  });
  assert(stage.response.status === 201 && typeof stage.body.id === "string", "stage create failed");

  const completedTask = await api(cookie, `/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title: "完成斜紋示範", stage_id: stage.body.id, due_date: "2026-06-30" }),
  });
  assert(completedTask.response.status === 201, "completed task create failed");
  const completedPatch = await api(cookie, `/tasks/${completedTask.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ start_date: "2026-06-01", due_date: "2026-06-30", done: true }),
  });
  assert(completedPatch.response.status === 200, "completed task patch failed");

  const overdueTask = await api(cookie, `/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title: "逾期紅端標示範", stage_id: stage.body.id, due_date: "2026-07-01" }),
  });
  assert(overdueTask.response.status === 201, "overdue task create failed");
  const overduePatch = await api(cookie, `/tasks/${overdueTask.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ start_date: "2026-06-15", due_date: "2026-07-01" }),
  });
  assert(overduePatch.response.status === 200, "overdue task patch failed");

  const milestonePeriod = await api(cookie, `/projects/${projectId}/milestones`, {
    method: "POST",
    body: JSON.stringify({ title: "九月里程碑期間", due_date: "2026-09-01", end_date: "2026-09-30" }),
  });
  assert(milestonePeriod.response.status === 201 && milestonePeriod.body.end_date === "2026-09-30", `milestone period create failed: ${JSON.stringify(milestonePeriod.body)}`);

  const eventPeriod = await api(cookie, `/projects/${projectId}/milestones`, {
    method: "POST",
    body: JSON.stringify({ title: "CDE 收案至回覆", due_date: "2026-02-06", end_date: "2026-03-23", kind: "event" }),
  });
  assert(eventPeriod.response.status === 201 && eventPeriod.body.end_date === "2026-03-23", `event period create failed: ${JSON.stringify(eventPeriod.body)}`);

  const point = await api(cookie, `/projects/${projectId}/milestones`, {
    method: "POST",
    body: JSON.stringify({ title: "單點里程碑", due_date: "2026-08-15" }),
  });
  assert(point.response.status === 201 && point.body.end_date === null, `point milestone create failed: ${JSON.stringify(point.body)}`);

  const overdueMilestone = await api(cookie, `/projects/${projectId}/milestones`, {
    method: "POST",
    body: JSON.stringify({ title: "逾期里程碑", due_date: "2026-07-01" }),
  });
  assert(overdueMilestone.response.status === 201, "overdue milestone create failed");

  const clearable = await api(cookie, `/projects/${projectId}/milestones`, {
    method: "POST",
    body: JSON.stringify({ title: "可清空期間", due_date: "2026-08-01", end_date: "2026-08-08" }),
  });
  assert(clearable.response.status === 201, "clearable milestone create failed");
  const cleared = await api(cookie, `/milestones/${clearable.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ end_date: null }),
  });
  assert(cleared.response.status === 200, "end_date clear failed");

  const invalid = await api(cookie, `/projects/${projectId}/milestones`, {
    method: "POST",
    body: JSON.stringify({ title: "錯誤期間", due_date: "2026-09-30", end_date: "2026-09-01" }),
  });
  assert(invalid.response.status === 422, `invalid range expected 422, got ${invalid.response.status}`);

  const detail = await api(cookie, `/projects/${projectId}`);
  assert(detail.response.status === 200, "project detail fetch failed");
  const byId = new Map(detail.body.milestones.map((item) => [item.id, item]));
  assert(byId.get(milestonePeriod.body.id)?.end_date === "2026-09-30", "detail API lost milestone end_date");
  assert(byId.get(eventPeriod.body.id)?.end_date === "2026-03-23", "detail API lost event end_date");
  assert(byId.get(point.body.id)?.end_date === null, "single point unexpectedly has end_date");
  assert(byId.get(clearable.body.id)?.end_date === null, "cleared end_date did not persist");

  const state = { project_id: projectId, stage_id: stage.body.id, email: fixture.email, password: fixture.password };
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return {
    project_id: projectId,
    demo_flag: 1,
    milestone: { due_date: "2026-09-01", end_date: "2026-09-30", dataset_kind: "bar" },
    event: { due_date: "2026-02-06", end_date: "2026-03-23", dataset_kind: "bar" },
    point: { due_date: "2026-08-15", end_date: null, dataset_kind: "diamond" },
    invalid_status: invalid.response.status,
    cleared_end_date: byId.get(clearable.body.id)?.end_date,
    visual_login: { email: fixture.email, password: fixture.password },
  };
}

async function cleanupAndVerify() {
  assert(existsSync(baselineFile), "baseline file missing");
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  let apiDeleteStatus = "not-needed";
  if (existsSync(stateFile)) {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    try {
      const cookie = await login();
      const deleted = await api(cookie, `/projects/${state.project_id}`, { method: "DELETE" });
      apiDeleteStatus = deleted.response.status;
      assert(deleted.response.status === 200 || deleted.response.status === 404, `demo API delete failed: ${deleted.response.status}`);
    } finally {
      cleanupFixtureRows();
    }
  } else {
    cleanupFixtureRows();
  }
  const cleanup = {
    users: queryD1(`SELECT COUNT(*) AS count FROM users WHERE id=${sqlValue(fixture.id)} AND is_demo=1`)[0]?.count,
    sessions: queryD1(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${sqlValue(fixture.id)}`)[0]?.count,
    projects: queryD1(`SELECT COUNT(*) AS count FROM projects WHERE owner_id=${sqlValue(fixture.id)} AND is_demo=1`)[0]?.count,
    audit_log: queryD1(`SELECT COUNT(*) AS count FROM audit_log WHERE user_id=${sqlValue(fixture.id)}`)[0]?.count,
  };
  assert(Object.values(cleanup).every((count) => count === 0), `demo cleanup incomplete: ${JSON.stringify(cleanup)}`);
  const after = protectedSnapshots();
  assert(JSON.stringify(after) === JSON.stringify(baseline), "protected fingerprints changed");
  if (existsSync(stateFile)) unlinkSync(stateFile);
  if (existsSync(baselineFile)) unlinkSync(baselineFile);
  return { api_delete_status: apiDeleteStatus, cleanup, before: baseline, after };
}

async function verifyHttp() {
  const unauthenticated = await fetch(`${base}/api/projects`);
  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(unauthenticated.status === 401, `unauthenticated API expected 401, got ${unauthenticated.status}`);
  assert(homepage.status === 200, `homepage expected 200, got ${homepage.status}`);
  assert(html.includes("<title>艾爾水晶-專案進度</title>"), "production title mismatch");
  return { unauthenticated_status: unauthenticated.status, homepage_status: homepage.status, title: "艾爾水晶-專案進度" };
}

const mode = process.argv[2];
if (mode === "--snapshot") {
  cleanupFixtureRows();
  const baseline = protectedSnapshots();
  assert(baseline.published.count === 631, `published baseline expected 631, got ${baseline.published.count}`);
  writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));
  console.log(JSON.stringify(baseline, null, 2));
} else if (mode === "--verify-migration") {
  console.log(JSON.stringify(verifyMigration(), null, 2));
} else if (mode === "--verify-built") {
  console.log(JSON.stringify(verifyBuiltAssets(), null, 2));
} else if (mode === "--prepare-e2e") {
  console.log(JSON.stringify(await prepareE2e(), null, 2));
} else if (mode === "--verify-http") {
  console.log(JSON.stringify(await verifyHttp(), null, 2));
} else if (mode === "--cleanup") {
  console.log(JSON.stringify(await cleanupAndVerify(), null, 2));
} else {
  throw new Error("usage: node scripts/v13-2-acceptance.mjs --snapshot|--verify-migration|--verify-built|--prepare-e2e|--verify-http|--cleanup");
}
