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
  owner: { id: "usr_e2e_v12_owner", email: "v12-owner@demo.local", name: "V12 Demo Owner", role: "member" },
  denied: { id: "usr_e2e_v12_denied", email: "v12-denied@demo.local", name: "V12 Demo Denied", role: "intern" },
};
const report = {
  baseline: {},
  deployment: {},
  suggestions: {},
  apply: {},
  ambiguous: {},
  permission: {},
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
    real_progress: snapshot("SELECT pu.* FROM progress_updates pu JOIN projects p ON p.id=pu.project_id WHERE p.is_demo=0 ORDER BY pu.id"),
  };
}

function cleanupFixture() {
  const owner = sqlValue(demo.owner.id);
  const denied = sqlValue(demo.denied.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM projects WHERE owner_id=${owner};
    DELETE FROM audit_log WHERE user_id IN (${owner},${denied});
    DELETE FROM sessions WHERE user_id IN (${owner},${denied});
    DELETE FROM users WHERE id IN (${owner},${denied});`);
}

function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const sessionId = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  runD1(`INSERT INTO sessions(id,user_id,expires_at) VALUES (${sqlValue(sessionId)},${sqlValue(userId)},${sqlValue(expiresAt)});`);
  return { token, cookie: `sid=${token}` };
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
  return { homepage, asset: [...entryScripts, ...chunks].join("\n"), scriptCount: scriptPaths.length, chunkCount: chunkPaths.length };
}

let failure;
let before;
let projectId = "";
let ownerSession;
try {
  cleanupFixture();
  before = protectedSnapshots();
  report.baseline = before;
  assert(before.published.count === 631, `published baseline expected 631, got ${before.published.count}`);
  assert(queryD1(`SELECT COUNT(*) AS count FROM groups WHERE id=${sqlValue(groupId)}`)[0]?.count === 1, "demo group is unavailable");

  runD1(`INSERT INTO users
      (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES
      (${sqlValue(demo.owner.id)},${sqlValue(demo.owner.email)},${sqlValue(demo.owner.name)},'v12-session-only',${sqlValue(demo.owner.role)},${sqlValue(groupId)},0,0,1,1,1,'approved'),
      (${sqlValue(demo.denied.id)},${sqlValue(demo.denied.email)},${sqlValue(demo.denied.name)},'v12-session-only',${sqlValue(demo.denied.role)},${sqlValue(groupId)},0,0,1,1,1,'approved');`);
  ownerSession = createSession(demo.owner.id);
  const deniedSession = createSession(demo.denied.id);

  const createdProject = await request("/api/projects", {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: {
      name: `V12 Progress Links E2E ${Date.now()}`,
      group_id: groupId,
      visibility: "private",
      description: "Fresh disposable V12 demo project",
      goal_summary: "Verify human-confirmed progress-to-task links",
    },
  });
  projectId = String(createdProject.body.id);
  assert(projectId.startsWith("prj_"), "project creation did not return a project id");
  runD1(`UPDATE projects SET is_demo=1 WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(demo.owner.id)};`);
  assert(queryD1(`SELECT COUNT(*) AS count FROM projects WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(demo.owner.id)} AND is_demo=1`)[0]?.count === 1, "fresh project was not marked demo");

  const firstStage = await request(`/api/projects/${projectId}/stages`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { name: "進行中" } });
  const secondStage = await request(`/api/projects/${projectId}/stages`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { name: "待處理" } });
  const stability = await request(`/api/projects/${projectId}/tasks`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { title: "安定性數據收集", stage_id: firstStage.body.id } });
  await request(`/api/projects/${projectId}/tasks`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { title: "包材確認", stage_id: secondStage.body.id } });

  const initial = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  assert(initial.body.tasks.length === 2 && initial.body.tasks.every((task) => task.done === 0), "demo project must start with two unfinished tasks");
  const initialProgress = Number(initial.body.project.progress);
  const progressText = "已完成安定性數據收集，下週送補件資料";
  const progressUpdate = await request(`/api/projects/${projectId}/progress-updates`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { content: progressText, progress_snapshot: initialProgress },
  });
  const beforeSuggestionTasks = queryD1(`SELECT id,title,stage_id,due_date,done,done_at FROM tasks WHERE project_id=${sqlValue(projectId)} ORDER BY id`);
  const beforeSuggestionProgress = queryD1(`SELECT progress FROM projects WHERE id=${sqlValue(projectId)}`)[0]?.progress;
  const suggestions = await request("/api/ai/progress-links", {
    cookie: ownerSession.cookie,
    method: "POST",
    body: { project_id: projectId, content: progressText, progress_update_id: progressUpdate.body.id, lang: "zh" },
  });
  report.suggestions = suggestions.body;
  assert(suggestions.body.fallback === false, "explicit suggestion request used fallback");
  assert(suggestions.body.complete.length === 1, `expected one complete suggestion, got ${suggestions.body.complete.length}`);
  assert(suggestions.body.complete[0].task_id === stability.body.id, "complete suggestion did not target the stability task");
  assert(suggestions.body.create.length === 1, `expected one create suggestion, got ${suggestions.body.create.length}`);
  assert(String(suggestions.body.create[0].title).includes("補件"), "create suggestion does not describe supplemental materials");
  const afterSuggestionTasks = queryD1(`SELECT id,title,stage_id,due_date,done,done_at FROM tasks WHERE project_id=${sqlValue(projectId)} ORDER BY id`);
  const afterSuggestionProgress = queryD1(`SELECT progress FROM projects WHERE id=${sqlValue(projectId)}`)[0]?.progress;
  assert(JSON.stringify(afterSuggestionTasks) === JSON.stringify(beforeSuggestionTasks), "suggestion endpoint wrote task data before human confirmation");
  assert(afterSuggestionProgress === beforeSuggestionProgress, "suggestion endpoint changed project progress before human confirmation");

  const createSuggestion = suggestions.body.create[0];
  const suggestedStage = initial.body.stages.find((stage) => stage.name === createSuggestion.stage_name);
  const selectedStageId = suggestedStage?.id ?? firstStage.body.id;
  await request(`/api/tasks/${stability.body.id}`, { cookie: ownerSession.cookie, method: "PATCH", body: { done: true } });
  const createdTask = await request(`/api/projects/${projectId}/tasks`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: createSuggestion.title, stage_id: selectedStageId, due_date: createSuggestion.due_date ?? null },
  });
  const applied = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const stabilityReadback = applied.body.tasks.find((task) => task.id === stability.body.id);
  const createdReadback = applied.body.tasks.find((task) => task.id === createdTask.body.id);
  assert(stabilityReadback?.done === 1, "selected stability task was not completed");
  assert(createdReadback?.title === createSuggestion.title, "selected new task was not created");
  assert(createdReadback?.stage_id === selectedStageId, "selected new task stage is incorrect");
  assert(Number(applied.body.project.progress) > initialProgress, `auto progress did not rise: ${initialProgress} -> ${applied.body.project.progress}`);
  report.apply = {
    human_confirmed_selection: true,
    stability_done: stabilityReadback.done,
    created_task_id: createdTask.body.id,
    created_stage_id: createdReadback.stage_id,
    initial_progress: initialProgress,
    final_progress: Number(applied.body.project.progress),
  };

  const ambiguous = await request("/api/ai/progress-links", {
    cookie: ownerSession.cookie,
    method: "POST",
    body: { project_id: projectId, content: "預計下週完成包材確認", lang: "zh" },
  });
  report.ambiguous = ambiguous.body;
  assert(ambiguous.body.fallback === false, "ambiguous-language request used fallback");
  assert(Array.isArray(ambiguous.body.complete) && ambiguous.body.complete.length === 0, "ambiguous future wording produced a complete suggestion");

  const denied = await request("/api/ai/progress-links", {
    cookie: deniedSession.cookie,
    method: "POST",
    expected: 403,
    body: { project_id: projectId, content: "已完成包材確認", lang: "zh" },
  });
  report.permission = { status: denied.response.status };

  await request("/api/projects", { expected: 401 });
  const assets = await productionAsset();
  assert(assets.asset.includes("AIUR_PROGRESS_LINKS"), "production assets are missing the V12 preference key");
  assert(assets.asset.includes("偵測到這筆進度可能影響以下任務"), "production assets are missing the V12 confirmation dialog");
  report.deployment = {
    homepage: assets.homepage.status,
    title: "艾爾水晶-專案進度",
    script_count: assets.scriptCount,
    chunk_count: assets.chunkCount,
    preference_key: true,
    confirmation_dialog: true,
  };
  report.regression = { unauthenticated: 401, published: before.published.count };
} catch (error) {
  failure = error;
} finally {
  try {
    if (projectId && ownerSession) {
      try {
        await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie, method: "DELETE" });
        report.cleanup.api_project_delete = true;
      } catch {
        report.cleanup.api_project_delete = false;
      }
    }
    cleanupFixture();
    const projectLiteral = sqlValue(projectId || "none");
    const owner = sqlValue(demo.owner.id);
    const denied = sqlValue(demo.denied.id);
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
      (SELECT COUNT(*) FROM users WHERE id IN (${owner},${denied})) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id IN (${owner},${denied})) AS sessions,
      (SELECT COUNT(*) FROM audit_log WHERE user_id IN (${owner},${denied}) OR entity_id=${projectLiteral}) AS audit_log`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup mismatch: ${JSON.stringify(remaining)}`);
    const after = protectedSnapshots();
    if (before) {
      for (const key of Object.keys(before)) assert(after[key].fingerprint === before[key].fingerprint, `${key} changed during V12 E2E`);
    }
    report.cleanup = { ...report.cleanup, readback: remaining, protected_fingerprints_unchanged: before ? true : null };
    report.regression = {
      ...report.regression,
      final_drafts: after.drafts.count,
      final_published: after.published.count,
      final_tombstones: after.tombstones.count,
      real_projects_unchanged: before ? after.real_projects.fingerprint === before.real_projects.fingerprint : null,
      real_tasks_unchanged: before ? after.real_tasks.fingerprint === before.real_tasks.fingerprint : null,
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
