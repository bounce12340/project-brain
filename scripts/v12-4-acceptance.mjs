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
    id: `usr_e2e_v12_4_${runId}`,
    email: `v12-4-${runId}@demo.local`,
    name: `V12.4 Demo Owner ${runId}`,
  },
};
const report = {
  migration: {},
  baseline: {},
  progress_exclusion: {},
  progress_links: {},
  presentation: {},
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
  const assetPaths = [
    ...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.(?:js|css))"/g),
  ].map((match) => match[1]);
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

  const milestoneColumns = queryD1("PRAGMA table_info(milestones)");
  const kindColumn = milestoneColumns.find((column) => column.name === "kind");
  const kinds = queryD1("SELECT kind,COUNT(*) AS count FROM milestones GROUP BY kind ORDER BY kind");
  assert(kindColumn?.type === "TEXT" && kindColumn?.dflt_value === "'milestone'", "remote milestones.kind schema is incorrect");
  assert(kinds.length === 1 && kinds[0].kind === "milestone" && kinds[0].count === 9, `remote backfill mismatch: ${JSON.stringify(kinds)}`);
  report.migration = {
    kind_column: kindColumn,
    pre_migration_rows_recorded: 9,
    backfilled_milestones: kinds[0].count,
    pending_migrations: 0,
  };

  await request("/api/projects", { expected: 401 });

  runD1(`INSERT INTO users
      (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES
      (${sqlValue(demo.owner.id)},${sqlValue(demo.owner.email)},${sqlValue(demo.owner.name)},'v12-4-session-only','member',${sqlValue(groupId)},0,0,1,1,1,'approved');`);
  ownerSession = createSession(demo.owner.id);

  const createdProject = await request("/api/projects", {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: {
      name: `V12.4 Acceptance Demo ${runId}`,
      group_id: groupId,
      visibility: "private",
      description: "Fresh disposable V12.4 acceptance fixture",
      goal_summary: "Verify history events never affect automatic progress",
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
  const taskOne = await request(`/api/projects/${projectId}/tasks`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: "Demo task one", stage_id: stage.body.id },
  });
  const taskTwo = await request(`/api/projects/${projectId}/tasks`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: "Demo task two", stage_id: stage.body.id },
  });
  await request(`/api/tasks/${taskOne.body.id}`, {
    cookie: ownerSession.cookie,
    method: "PATCH",
    body: { done: true },
  });
  const beforeEvents = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  assert(beforeEvents.body.project.progress === 50, `two tasks with one done expected 50, got ${beforeEvents.body.project.progress}`);

  const manualEvents = [
    ["CDE 第一次諮詢", "2025-12-09"],
    ["完成送件前會議", "2026-01-15"],
    ["開始準備 CTD", "2026-05-11"],
  ];
  for (const [title, due_date] of manualEvents) {
    await request(`/api/projects/${projectId}/milestones`, {
      cookie: ownerSession.cookie,
      method: "POST",
      expected: 201,
      body: { title, due_date, kind: "event" },
    });
  }
  const afterEvents = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const eventRows = afterEvents.body.milestones.filter((item) => item.kind === "event");
  assert(eventRows.length === 3, `expected 3 events, got ${JSON.stringify(eventRows)}`);
  assert(eventRows.every((item) => item.done === 1), "an event was not created done=1");
  assert(afterEvents.body.project.progress === 50, `events changed progress to ${afterEvents.body.project.progress}`);
  assert(afterEvents.body.tasks.length === 2 && afterEvents.body.tasks.filter((task) => task.done === 1).length === 1, "demo task fixture mismatch");
  report.progress_exclusion = {
    tasks: 2,
    completed_tasks: 1,
    events: eventRows.length,
    all_events_done: true,
    progress_before_events: beforeEvents.body.project.progress,
    progress_after_events: afterEvents.body.project.progress,
  };

  const progressText = "2025/12/09 已完成會議；預計 2026/12/01 提供文件";
  const progressUpdate = await request(`/api/projects/${projectId}/progress-updates`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { content: progressText, progress_snapshot: afterEvents.body.project.progress },
  });
  const beforeSuggestions = queryD1(`SELECT id,title,due_date,done,kind FROM milestones WHERE project_id=${sqlValue(projectId)} ORDER BY id`);
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
  assert(suggestions.body.fallback === false, "progress-links used fallback");
  assert(Array.isArray(suggestions.body.events) && suggestions.body.events.length === 1, `expected one event, got ${JSON.stringify(suggestions.body.events)}`);
  assert(suggestions.body.events[0].event_date === "2025-12-09", "history event date is incorrect");
  assert(Array.isArray(suggestions.body.milestones) && suggestions.body.milestones.length === 1, `expected one milestone, got ${JSON.stringify(suggestions.body.milestones)}`);
  assert(suggestions.body.milestones[0].due_date === "2026-12-01", "future milestone date is incorrect");
  const afterSuggestions = queryD1(`SELECT id,title,due_date,done,kind FROM milestones WHERE project_id=${sqlValue(projectId)} ORDER BY id`);
  assert(JSON.stringify(afterSuggestions) === JSON.stringify(beforeSuggestions), "suggestion request wrote data before human application");

  const eventSuggestion = suggestions.body.events[0];
  const appliedEvent = await request(`/api/projects/${projectId}/milestones`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: eventSuggestion.title, due_date: eventSuggestion.event_date, kind: "event" },
  });
  const afterEventApply = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  assert(afterEventApply.body.project.progress === 50, `applied history event changed progress to ${afterEventApply.body.project.progress}`);

  const milestoneSuggestion = suggestions.body.milestones[0];
  const appliedMilestone = await request(`/api/projects/${projectId}/milestones`, {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: { title: milestoneSuggestion.title, due_date: milestoneSuggestion.due_date },
  });
  const afterMilestoneApply = await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie });
  const eventReadback = afterMilestoneApply.body.milestones.find((item) => item.id === appliedEvent.body.id);
  const milestoneReadback = afterMilestoneApply.body.milestones.find((item) => item.id === appliedMilestone.body.id);
  assert(eventReadback?.kind === "event" && eventReadback.done === 1, "applied event readback is incorrect");
  assert(milestoneReadback?.kind === "milestone" && milestoneReadback.done === 0, "applied milestone readback is incorrect");
  assert(afterMilestoneApply.body.project.progress === 33, `milestone denominator expected progress 33, got ${afterMilestoneApply.body.project.progress}`);
  report.progress_links = {
    response: suggestions.body,
    suggestion_writes_before_apply: false,
    progress_before_apply: 50,
    progress_after_event_apply: afterEventApply.body.project.progress,
    progress_after_milestone_apply: afterMilestoneApply.body.project.progress,
    applied_event: eventReadback,
    applied_milestone: milestoneReadback,
  };

  const timeline = await request("/api/timeline", { cookie: ownerSession.cookie });
  const timelineProject = timeline.body.groups.flatMap((group) => group.projects).find((project) => project.id === projectId);
  assert(timelineProject?.events?.length === 4, `timeline event readback mismatch: ${JSON.stringify(timelineProject?.events)}`);
  const assets = await productionAssets();
  assert(assets.asset.includes("歷程事件") && assets.asset.includes("History events"), "production assets lack history-event i18n");
  assert(assets.asset.includes("event_date"), "production assets lack calendar/timeline event branch");
  assert(assets.asset.includes("goldDim") && assets.asset.includes('fill:"none"'), "production assets lack hollow dim-gold Gantt branch");
  assert(assets.asset.includes("bg-star-dim"), "production assets lack secondary calendar dot branch");
  report.presentation = {
    api_kind_field: true,
    project_event_count: afterMilestoneApply.body.milestones.filter((item) => item.kind === "event").length,
    timeline_event_count: timelineProject.events.length,
    built_history_i18n: true,
    built_event_date_branch: true,
    built_hollow_gold_branch: true,
    built_calendar_dot_branch: true,
  };
  report.deployment = {
    homepage: assets.homepage.status,
    title: "艾爾水晶-專案進度",
    entry_asset_count: assets.entryCount,
    chunk_count: assets.chunkCount,
    version_id: "d8aae694-5f3e-4415-865f-abfcf4e50ada",
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
      (SELECT COUNT(*) FROM notifications WHERE user_id=${owner}) AS notifications,
      (SELECT COUNT(*) FROM users WHERE id=${owner}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${owner}) AS sessions,
      (SELECT COUNT(*) FROM audit_log WHERE user_id=${owner} OR entity_id=${projectLiteral}) AS audit_log`)[0];
    assert(Object.values(remaining).every((value) => value === 0), `fixture cleanup mismatch: ${JSON.stringify(remaining)}`);
    const after = protectedSnapshots();
    if (before) {
      for (const key of Object.keys(before)) {
        assert(after[key].fingerprint === before[key].fingerprint, `${key} changed during V12.4 E2E`);
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
