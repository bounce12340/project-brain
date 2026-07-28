import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const groupId = "grp_general";
const runId = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const demo = {
  owner: {
    id: `usr_e2e_v12_5_${runId}`,
    email: `v12-5-${runId}@demo.local`,
    name: `V12.5 Demo Owner ${runId}`,
  },
};
const report = {
  baseline: {},
  dependency_dates: {},
  front_end_only: {},
  manual_protection: {},
  cycle_regression: {},
  built_assets: {},
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
  };
}

function cleanupFixture() {
  const owner = sqlValue(demo.owner.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM projects WHERE owner_id=${owner} AND is_demo=1;
    DELETE FROM notifications WHERE user_id=${owner};
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

async function productionAssets() {
  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200, `homepage expected 200, got ${homepage.status}`);
  assert(html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const assetPaths = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert(assetPaths.length > 0, "production HTML has no assets");
  const entryAssets = await Promise.all(assetPaths.map(async (assetPath) => {
    const response = await fetch(new URL(assetPath, base));
    assert(response.ok, `could not fetch production asset ${assetPath}`);
    return response.text();
  }));
  const scriptPath = assetPaths.find((value) => value.endsWith(".js"));
  const chunkPaths = scriptPath ? [...new Set(entryAssets.flatMap((asset) =>
    [...asset.matchAll(/(?:"|')((?:\.\/|assets\/)[^"']+\.js)(?:"|')/g)].map((match) =>
      match[1].startsWith("assets/") ? `/${match[1]}` : new URL(match[1], new URL(scriptPath, base)).pathname,
    ),
  ))] : [];
  const chunks = await Promise.all(chunkPaths.map(async (chunkPath) => {
    const response = await fetch(new URL(chunkPath, base));
    assert(response.ok, `could not fetch production chunk ${chunkPath}`);
    return response.text();
  }));
  return {
    homepage,
    asset: [...entryAssets, ...chunks].join("\n"),
    entryCount: assetPaths.length,
    chunkCount: chunkPaths.length,
  };
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

  await request("/api/projects", { expected: 401 });

  runD1(`INSERT INTO users
      (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES
      (${sqlValue(demo.owner.id)},${sqlValue(demo.owner.email)},${sqlValue(demo.owner.name)},'v12-5-session-only','member',${sqlValue(groupId)},0,0,1,1,1,'approved');`);
  ownerSession = createSession(demo.owner.id);

  const createdProject = await request("/api/projects", {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: {
      name: `V12.5 Acceptance Demo ${runId}`,
      group_id: groupId,
      visibility: "private",
      description: "Fresh disposable V12.5 acceptance fixture",
      goal_summary: "Verify dependency-first task date continuation",
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
    body: { name: "V12.5 demo stage" },
  });
  const createTask = async (title, due_date) => (await request(`/api/projects/${projectId}/tasks`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title, stage_id: stage.body.id, ...(due_date ? { due_date } : {}) },
  })).body.id;
  const taskA = await createTask("A — prerequisite due 2026-09-10", "2026-09-10");
  const taskB = await createTask("B — dependent without dates");
  const taskC = await createTask("C — later prerequisite due 2026-09-15", "2026-09-15");
  const taskD = await createTask("D — server must not auto-fill");

  await request(`/api/tasks/${taskD}`, {
    cookie: ownerSession.cookie,
    method: "PATCH",
    body: { dependency_ids: [taskA] },
  });
  const afterDependencyOnly = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const rowD = afterDependencyOnly.body.tasks.find((task) => task.id === taskD);
  assert(rowD?.start_date === null && rowD?.due_date === null, `dependency-only PATCH auto-wrote dates: ${JSON.stringify(rowD)}`);
  report.front_end_only = {
    dependency_saved: rowD.dependency_ids,
    start_date_after_dependency_only_patch: rowD.start_date,
    due_date_after_dependency_only_patch: rowD.due_date,
  };

  await request(`/api/tasks/${taskB}`, {
    cookie: ownerSession.cookie,
    method: "PATCH",
    body: { dependency_ids: [taskA], start_date: "2026-09-11" },
  });
  const afterFirstSave = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const firstB = afterFirstSave.body.tasks.find((task) => task.id === taskB);
  assert(firstB?.start_date === "2026-09-11", `B start_date mismatch: ${JSON.stringify(firstB)}`);
  assert(firstB?.due_date === null, "B acquired an unexpected due date");
  assert(firstB?.dependency_ids?.length === 1 && firstB.dependency_ids[0] === taskA, `B dependencies mismatch: ${JSON.stringify(firstB?.dependency_ids)}`);
  report.dependency_dates = {
    prerequisite_due_date: "2026-09-10",
    suggested_start_date: "2026-09-11",
    api_start_date: firstB.start_date,
    api_due_date: firstB.due_date,
    dependency_ids: firstB.dependency_ids,
  };

  await request(`/api/tasks/${taskB}`, {
    cookie: ownerSession.cookie,
    method: "PATCH",
    body: { dependency_ids: [taskA, taskC], start_date: "2026-09-20" },
  });
  const afterManualSave = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const manualB = afterManualSave.body.tasks.find((task) => task.id === taskB);
  assert(manualB?.start_date === "2026-09-20", `manual B start_date was overwritten: ${JSON.stringify(manualB)}`);
  assert(manualB?.dependency_ids?.length === 2 && manualB.dependency_ids.includes(taskA) && manualB.dependency_ids.includes(taskC), "changed dependency set was not saved");
  report.manual_protection = {
    manual_start_date: "2026-09-20",
    latest_prerequisite_due_date: "2026-09-15",
    suggested_start_date: "2026-09-16",
    api_start_date_after_dependency_change: manualB.start_date,
    dependency_ids: manualB.dependency_ids,
  };

  const cycle = await request(`/api/tasks/${taskA}`, {
    cookie: ownerSession.cookie,
    method: "PATCH",
    expected: 422,
    body: { dependency_ids: [taskB] },
  });
  const afterCycle = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const rowA = afterCycle.body.tasks.find((task) => task.id === taskA);
  assert(rowA?.dependency_ids?.length === 0, "rejected cycle changed A dependencies");
  report.cycle_regression = {
    status: cycle.response.status,
    error: cycle.body.error,
    dependencies_after_rejection: rowA.dependency_ids,
  };

  const assets = await productionAssets();
  const dependencyMarker = assets.asset.indexOf('data-task-drawer-section":"dependencies"');
  const datesMarker = assets.asset.indexOf('data-task-drawer-section":"dates"');
  assert(dependencyMarker >= 0 && datesMarker > dependencyMarker, "built task drawer does not place dependencies before dates");
  assert(assets.asset.includes("已依前置任務帶入，可修改") && assets.asset.includes("Filled from prerequisites; you can edit it"), "built assets lack auto-fill i18n");
  assert(assets.asset.includes("建議起始日") && assets.asset.includes("Suggested start date"), "built assets lack manual-date suggestion i18n");
  assert(assets.asset.includes("前置任務尚未設定到期日") && assets.asset.includes("A prerequisite has no due date"), "built assets lack missing-due-date i18n");
  assert(assets.asset.includes("auto-applied") && assets.asset.includes("missing-due-date") && assets.asset.includes("suggestion"), "built assets lack dependency date state branches");
  report.built_assets = {
    homepage: assets.homepage.status,
    title: "艾爾水晶-專案進度",
    entry_asset_count: assets.entryCount,
    chunk_count: assets.chunkCount,
    dependencies_before_dates: true,
    auto_fill_i18n: true,
    manual_suggestion_i18n: true,
    missing_due_i18n: true,
    date_state_branches: true,
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
      (SELECT COUNT(*) FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE project_id=${projectLiteral})) AS task_dependencies,
      (SELECT COUNT(*) FROM progress_updates WHERE project_id=${projectLiteral}) AS progress_updates,
      (SELECT COUNT(*) FROM project_members WHERE project_id=${projectLiteral}) AS project_members,
      (SELECT COUNT(*) FROM milestones WHERE project_id=${projectLiteral}) AS milestones,
      (SELECT COUNT(*) FROM files WHERE project_id=${projectLiteral}) AS files,
      (SELECT COUNT(*) FROM automation_rules WHERE project_id=${projectLiteral}) AS automation_rules,
      (SELECT COUNT(*) FROM key_results WHERE project_id=${projectLiteral}) AS key_results,
      (SELECT COUNT(*) FROM notifications WHERE user_id=${owner}) AS notifications,
      (SELECT COUNT(*) FROM users WHERE id=${owner}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${owner}) AS sessions,
      (SELECT COUNT(*) FROM audit_log WHERE user_id=${owner} OR entity_id=${projectLiteral}) AS audit_log`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup mismatch: ${JSON.stringify(remaining)}`);
    const after = protectedSnapshots();
    if (before) {
      for (const key of Object.keys(before)) {
        assert(after[key].fingerprint === before[key].fingerprint, `${key} changed during V12.5 E2E`);
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
      fingerprints: after,
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
