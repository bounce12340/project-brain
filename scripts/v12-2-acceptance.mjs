import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const groupId = "grp_general";
const demo = {
  owner: {
    id: "usr_e2e_v12_2_owner",
    email: "v12-2-owner@demo.local",
    name: "V12.2 Demo Owner",
  },
};
const report = {
  baseline: {},
  timezone: {},
  duplicate_guard: {},
  progress_links: {},
  deployment: {},
  regression: {},
  cleanup: {},
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

function fingerprint(rows) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function snapshot(sql) {
  const rows = queryD1(sql);
  return { count: rows.length, fingerprint: fingerprint(rows) };
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
  const owner = sqlValue(demo.owner.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM projects WHERE owner_id=${owner} AND is_demo=1;
    DELETE FROM audit_log WHERE user_id=${owner};
    DELETE FROM sessions WHERE user_id=${owner};
    DELETE FROM users WHERE id=${owner} AND is_demo=1;`);
}

function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const sessionId = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  runD1(`INSERT INTO sessions(id,user_id,expires_at) VALUES (${sqlValue(sessionId)},${sqlValue(userId)},${sqlValue(expiresAt)});`);
  return { cookie: `sid=${token}` };
}

async function request(pathname, { cookie = "", method = "GET", body, expected = 200 } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  assert(response.status === expected, `${method} ${pathname}: expected ${expected}, got ${response.status}, body=${JSON.stringify(responseBody)}`);
  return { response, body: responseBody };
}

async function productionAsset() {
  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200, `homepage expected 200, got ${homepage.status}`);
  assert(html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  assert(scriptPaths.length > 0, "production HTML has no JavaScript asset");
  const entryScripts = await Promise.all(scriptPaths.map(async (scriptPath) => {
    const response = await fetch(new URL(scriptPath, base));
    assert(response.ok, `could not fetch production asset ${scriptPath}`);
    return response.text();
  }));
  const chunkPaths = [...new Set(entryScripts.flatMap((script) =>
    [...script.matchAll(/(?:"|')((?:\.\/|assets\/)[^"']+\.js)(?:"|')/g)].map((match) =>
      match[1].startsWith("assets/") ? `/${match[1]}` : new URL(match[1], new URL(scriptPaths[0], base)).pathname,
    ),
  ))];
  const chunks = await Promise.all(chunkPaths.map(async (chunkPath) => {
    const response = await fetch(new URL(chunkPath, base));
    assert(response.ok, `could not fetch production chunk ${chunkPath}`);
    return response.text();
  }));
  return {
    homepage,
    asset: [...entryScripts, ...chunks].join("\n"),
    scriptCount: scriptPaths.length,
    chunkCount: chunkPaths.length,
  };
}

function parseFixture(value) {
  if (value.length === 10) return new Date(`${value}T00:00:00+08:00`);
  if (/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return new Date(value);
  return new Date(`${value.replace(" ", "T")}Z`);
}

function taipeiTime(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parseFixture(value));
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

function validFutureDate(value, today) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value <= today) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

let failure;
let before;
let ownerSession;
let projectId = "";
try {
  cleanupFixture();
  before = protectedSnapshots();
  report.baseline = before;
  assert(before.published.count === 631, `published baseline expected 631, got ${before.published.count}`);
  assert(queryD1(`SELECT COUNT(*) AS count FROM groups WHERE id=${sqlValue(groupId)}`)[0]?.count === 1, "demo group is unavailable");

  const naiveDisplay = taipeiTime("2026-07-28 02:07:18");
  const zDisplay = taipeiTime("2026-07-28T02:07:18Z");
  const dateOnlyInstant = parseFixture("2026-07-28").toISOString();
  assert(naiveDisplay === "10:07", `naive fixture displayed ${naiveDisplay}`);
  assert(zDisplay === "10:07", `Z fixture displayed ${zDisplay}`);
  assert(dateOnlyInstant === "2026-07-27T16:00:00.000Z", `date-only fixture changed: ${dateOnlyInstant}`);
  report.timezone = {
    naive_fixture: "2026-07-28 02:07:18",
    naive_taipei_display: naiveDisplay,
    z_taipei_display: zDisplay,
    date_only_utc_instant: dateOnlyInstant,
  };

  runD1(`INSERT INTO users
      (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES
      (${sqlValue(demo.owner.id)},${sqlValue(demo.owner.email)},${sqlValue(demo.owner.name)},'v12-2-session-only','member',${sqlValue(groupId)},0,0,1,1,1,'approved');`);
  ownerSession = createSession(demo.owner.id);

  const createdProject = await request("/api/projects", {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: {
      name: `V12.2 Acceptance Demo ${Date.now()}`,
      group_id: groupId,
      visibility: "private",
      description: "Fresh disposable V12.2 acceptance fixture",
      goal_summary: "Verify timezone, milestone deduplication, and progress links",
    },
  });
  projectId = String(createdProject.body.id);
  assert(projectId.startsWith("prj_"), "project creation did not return a project id");
  runD1(`UPDATE projects SET is_demo=1 WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(demo.owner.id)};`);
  assert(queryD1(`SELECT COUNT(*) AS count FROM projects WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(demo.owner.id)} AND is_demo=1`)[0]?.count === 1, "fresh project was not marked demo");

  const stage = await request(`/api/projects/${projectId}/stages`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { name: "進行中" },
  });
  const task = await request(`/api/projects/${projectId}/tasks`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: "審查 X 文件", stage_id: stage.body.id },
  });

  const duplicateTitle = `V12.2 Duplicate ${Date.now()}`;
  const firstMilestone = await request(`/api/projects/${projectId}/milestones`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: duplicateTitle, due_date: "2026-11-30" },
  });
  const duplicate = await request(`/api/projects/${projectId}/milestones`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 409,
    body: { title: duplicateTitle, due_date: "2026-11-30" },
  });
  assert(duplicate.body.error === "相同里程碑已存在", `unexpected 409 body: ${JSON.stringify(duplicate.body)}`);
  assert(queryD1(`SELECT COUNT(*) AS count FROM milestones WHERE project_id=${sqlValue(projectId)} AND title=${sqlValue(duplicateTitle)} AND due_date='2026-11-30'`)[0]?.count === 1, "duplicate milestone was inserted");
  report.duplicate_guard = {
    first_status: 201,
    first_id: firstMilestone.body.id,
    second_status: duplicate.response.status,
    second_error: duplicate.body.error,
    stored_count: 1,
  };

  const progressText = "Hina 預計於 2026/12/01 提供 X 文件；收到 X 文件後，既有任務「審查 X 文件」應於 2026/12/31 前完成（為期一個月）。2025/12/09 已完成會議。";
  const progressUpdate = await request(`/api/projects/${projectId}/progress-updates`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { content: progressText, progress_snapshot: 0 },
  });
  const beforeSuggestions = {
    tasks: queryD1(`SELECT id,title,due_date,done FROM tasks WHERE project_id=${sqlValue(projectId)} ORDER BY id`),
    milestones: queryD1(`SELECT id,title,due_date,done FROM milestones WHERE project_id=${sqlValue(projectId)} ORDER BY id`),
  };
  const suggestions = await request("/api/ai/progress-links", {
    cookie: ownerSession.cookie,
    method: "POST",
    body: {
      project_id: projectId,
      content: progressText,
      progress_update_id: progressUpdate.body.id,
      lang: "zh",
    },
  });
  report.progress_links.raw_response = suggestions.body;
  assert(suggestions.body.fallback === false, "progress-links used fallback");
  assert(Array.isArray(suggestions.body.milestones) && suggestions.body.milestones.length === 1, `expected one milestone, got ${JSON.stringify(suggestions.body.milestones)}`);
  assert(suggestions.body.milestones[0].due_date === "2026-12-01", "future milestone date is incorrect");
  assert(Array.isArray(suggestions.body.dates) && suggestions.body.dates.length >= 1, `expected a task date, got ${JSON.stringify(suggestions.body.dates)}`);
  const dateSuggestion = suggestions.body.dates.find((item) => item.task_id === task.body.id);
  assert(dateSuggestion, "dates did not target the existing unfinished task");
  assert(validFutureDate(dateSuggestion.due_date, "2026-07-28"), `invalid suggested task date: ${dateSuggestion.due_date}`);
  const allSuggestedDates = [
    ...suggestions.body.create.map((item) => item.due_date).filter(Boolean),
    ...suggestions.body.milestones.map((item) => item.due_date),
    ...suggestions.body.dates.map((item) => item.due_date),
  ];
  assert(!allSuggestedDates.some((date) => date.startsWith("2025-")), `historical date created an object: ${JSON.stringify(suggestions.body)}`);
  const afterSuggestions = {
    tasks: queryD1(`SELECT id,title,due_date,done FROM tasks WHERE project_id=${sqlValue(projectId)} ORDER BY id`),
    milestones: queryD1(`SELECT id,title,due_date,done FROM milestones WHERE project_id=${sqlValue(projectId)} ORDER BY id`),
  };
  assert(JSON.stringify(afterSuggestions) === JSON.stringify(beforeSuggestions), "suggestion request wrote data before human application");

  const milestoneSuggestion = suggestions.body.milestones[0];
  const appliedMilestone = await request(`/api/projects/${projectId}/milestones`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: milestoneSuggestion.title, due_date: milestoneSuggestion.due_date },
  });
  await request(`/api/tasks/${task.body.id}`, {
    cookie: ownerSession.cookie,
    method: "PATCH",
    body: { due_date: dateSuggestion.due_date },
  });
  const applied = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const milestoneReadback = applied.body.milestones.find((item) => item.id === appliedMilestone.body.id);
  const taskReadback = applied.body.tasks.find((item) => item.id === task.body.id);
  assert(milestoneReadback?.due_date === "2026-12-01", "applied milestone readback is incorrect");
  assert(taskReadback?.due_date === dateSuggestion.due_date, "applied task date readback is incorrect");
  report.progress_links = {
    response: suggestions.body,
    historical_object_count: allSuggestedDates.filter((date) => date.startsWith("2025-")).length,
    suggestion_writes_before_apply: false,
    applied_milestone: { id: appliedMilestone.body.id, title: milestoneReadback.title, due_date: milestoneReadback.due_date },
    applied_task_date: { task_id: task.body.id, due_date: taskReadback.due_date },
  };

  await request("/api/projects", { expected: 401 });
  const assets = await productionAsset();
  assert(assets.asset.includes('replace(" ","T")'), "production assets are missing naive datetime normalization");
  assert(assets.asset.includes("Asia/Taipei"), "production assets are missing Taipei timezone formatting");
  assert(assets.asset.includes("新增里程碑"), "production assets are missing the milestone suggestion UI");
  assert(assets.asset.includes("設定既有任務日期"), "production assets are missing the date suggestion UI");
  report.deployment = {
    homepage: assets.homepage.status,
    title: "艾爾水晶-專案進度",
    script_count: assets.scriptCount,
    chunk_count: assets.chunkCount,
    timezone_normalizer: true,
    milestone_ui: true,
    task_date_ui: true,
  };
  report.regression = {
    unauthenticated: 401,
    published: before.published.count,
  };
} catch (error) {
  failure = error;
} finally {
  try {
    if (projectId && ownerSession) {
      try {
        await request(`/api/projects/${projectId}`, {
          cookie: ownerSession.cookie,
          method: "DELETE",
        });
        report.cleanup.api_project_delete = true;
      } catch {
        report.cleanup.api_project_delete = false;
      }
    }
    cleanupFixture();
    const projectLiteral = sqlValue(projectId || "none");
    const owner = sqlValue(demo.owner.id);
    const remaining = queryD1(`SELECT
      (SELECT COUNT(*) FROM projects WHERE id=${projectLiteral} OR owner_id=${owner}) AS projects,
      (SELECT COUNT(*) FROM stages WHERE project_id=${projectLiteral}) AS stages,
      (SELECT COUNT(*) FROM tasks WHERE project_id=${projectLiteral}) AS tasks,
      (SELECT COUNT(*) FROM progress_updates WHERE project_id=${projectLiteral}) AS progress_updates,
      (SELECT COUNT(*) FROM project_members WHERE project_id=${projectLiteral}) AS project_members,
      (SELECT COUNT(*) FROM milestones WHERE project_id=${projectLiteral}) AS milestones,
      (SELECT COUNT(*) FROM files WHERE project_id=${projectLiteral}) AS files,
      (SELECT COUNT(*) FROM automation_rules WHERE project_id=${projectLiteral}) AS automation_rules,
      (SELECT COUNT(*) FROM key_results WHERE project_id=${projectLiteral}) AS key_results,
      (SELECT COUNT(*) FROM users WHERE id=${owner}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${owner}) AS sessions,
      (SELECT COUNT(*) FROM audit_log WHERE user_id=${owner} OR entity_id=${projectLiteral}) AS audit_log`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup mismatch: ${JSON.stringify(remaining)}`);
    const after = protectedSnapshots();
    if (before) {
      for (const key of Object.keys(before)) {
        assert(after[key].fingerprint === before[key].fingerprint, `${key} changed during V12.2 E2E`);
      }
    }
    report.cleanup = {
      ...report.cleanup,
      readback: remaining,
      protected_fingerprints_unchanged: before ? true : null,
    };
    report.regression = {
      ...report.regression,
      final_drafts: after.drafts.count,
      final_published: after.published.count,
      final_tombstones: after.tombstones.count,
      real_projects_unchanged: before ? after.real_projects.fingerprint === before.real_projects.fingerprint : null,
      real_tasks_unchanged: before ? after.real_tasks.fingerprint === before.real_tasks.fingerprint : null,
      real_milestones_unchanged: before ? after.real_milestones.fingerprint === before.real_milestones.fingerprint : null,
      real_progress_unchanged: before ? after.real_progress.fingerprint === before.real_progress.fingerprint : null,
    };
  } catch (error) {
    failure ??= error;
  }
}

if (failure) {
  console.error(JSON.stringify(report, null, 2));
  throw failure;
}

console.log(JSON.stringify(report, null, 2));
