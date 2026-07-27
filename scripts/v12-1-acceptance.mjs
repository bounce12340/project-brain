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
  owner: { id: "usr_e2e_v12_1_owner", email: "v12-1-owner@demo.local", name: "V12.1 Demo Owner" },
  author: { id: "usr_e2e_v12_1_author", email: "v12-1-author@demo.local", name: "V12.1 Demo Author" },
  other: { id: "usr_e2e_v12_1_other", email: "v12-1-other@demo.local", name: "V12.1 Demo Other" },
};
const demoUsers = Object.values(demo);
const report = {
  baseline: {},
  migration: {},
  edit: {},
  permission: {},
  deletion: {},
  autoDeletion: {},
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
    realProjects: snapshot("SELECT * FROM projects WHERE is_demo=0 ORDER BY id"),
    realTasks: snapshot("SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.is_demo=0 ORDER BY t.id"),
    realProgress: snapshot("SELECT pu.* FROM progress_updates pu JOIN projects p ON p.id=pu.project_id WHERE p.is_demo=0 ORDER BY pu.id"),
  };
}

function demoUserList() {
  return demoUsers.map((user) => sqlValue(user.id)).join(",");
}

function cleanupFixture() {
  const ids = demoUserList();
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM audit_log WHERE user_id IN (${ids});
    DELETE FROM projects WHERE owner_id=${sqlValue(demo.owner.id)};
    DELETE FROM sessions WHERE user_id IN (${ids});
    DELETE FROM users WHERE id IN (${ids});`);
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
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  assert(scripts.length > 0, "production HTML has no JavaScript asset");
  const entryAssets = await Promise.all(scripts.map(async (script) => {
    const response = await fetch(new URL(script, base));
    assert(response.ok, `could not fetch ${script}`);
    return await response.text();
  }));
  const chunks = [...new Set(entryAssets.flatMap((asset) =>
    [...asset.matchAll(/(?:"|')((?:\.\/|assets\/)[^"']+\.js)(?:"|')/g)].map((match) =>
      match[1].startsWith("assets/") ? `/${match[1]}` : new URL(match[1], new URL(scripts[0], base)).pathname,
    ),
  ))];
  const chunkAssets = await Promise.all(chunks.map(async (chunk) => {
    const response = await fetch(new URL(chunk, base));
    assert(response.ok, `could not fetch ${chunk}`);
    return await response.text();
  }));
  return { homepage, asset: [...entryAssets, ...chunkAssets].join("\n"), scriptCount: scripts.length, chunkCount: chunks.length };
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

  const columns = queryD1("PRAGMA table_info(progress_updates)").map((column) => column.name);
  const migration = queryD1("SELECT name FROM d1_migrations WHERE name='0011_v12_1.sql'");
  assert(columns.includes("edited_at") && columns.includes("edited_by"), "remote progress_updates lacks edited columns");
  assert(migration.length === 1, "remote migration 0011 is not recorded");
  report.migration = { edited_at: true, edited_by: true, recorded: migration[0].name };

  runD1(`INSERT INTO users
      (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES
      (${sqlValue(demo.owner.id)},${sqlValue(demo.owner.email)},${sqlValue(demo.owner.name)},'v12-1-session-only','member',${sqlValue(groupId)},0,0,1,1,1,'approved'),
      (${sqlValue(demo.author.id)},${sqlValue(demo.author.email)},${sqlValue(demo.author.name)},'v12-1-session-only','member',${sqlValue(groupId)},0,0,1,1,1,'approved'),
      (${sqlValue(demo.other.id)},${sqlValue(demo.other.email)},${sqlValue(demo.other.name)},'v12-1-session-only','member',${sqlValue(groupId)},0,0,1,1,1,'approved');`);
  ownerSession = createSession(demo.owner.id);
  const authorSession = createSession(demo.author.id);
  const otherSession = createSession(demo.other.id);

  const createdProject = await request("/api/projects", {
    cookie: ownerSession.cookie,
    method: "POST",
    expected: 201,
    body: {
      name: `V12.1 Progress Mutation E2E ${Date.now()}`,
      group_id: groupId,
      visibility: "private",
      description: "Fresh disposable V12.1 demo project",
      goal_summary: "Verify progress edit/delete audit trail",
    },
  });
  projectId = String(createdProject.body.id);
  assert(projectId.startsWith("prj_"), "project creation did not return a project id");
  runD1(`UPDATE projects SET is_demo=1 WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(demo.owner.id)};`);
  assert(queryD1(`SELECT COUNT(*) AS count FROM projects WHERE id=${sqlValue(projectId)} AND owner_id=${sqlValue(demo.owner.id)} AND is_demo=1`)[0]?.count === 1, "fresh project was not marked demo");
  await request(`/api/projects/${projectId}/members`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { user_id: demo.author.id } });
  await request(`/api/projects/${projectId}/members`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { user_id: demo.other.id } });

  const stage = await request(`/api/projects/${projectId}/stages`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { name: "進行中" } });
  const task = await request(`/api/projects/${projectId}/tasks`, { cookie: ownerSession.cookie, method: "POST", expected: 201, body: { title: "V12.1 Demo Task", stage_id: stage.body.id } });
  const originalContent = "V12.1 作者原始進度，snapshot 必須保留";
  const editedContent = "V12.1 作者修正後進度，snapshot 仍須保留";
  const createdUpdate = await request(`/api/projects/${projectId}/progress-updates`, {
    cookie: authorSession.cookie,
    method: "POST",
    expected: 201,
    body: { content: originalContent, progress_snapshot: 0 },
  });
  const updateId = String(createdUpdate.body.id);
  const beforeEdit = queryD1(`SELECT * FROM progress_updates WHERE id=${sqlValue(updateId)}`)[0];
  await request(`/api/progress-updates/${updateId}`, {
    cookie: authorSession.cookie,
    method: "PATCH",
    body: { content: editedContent },
  });
  const afterEdit = queryD1(`SELECT * FROM progress_updates WHERE id=${sqlValue(updateId)}`)[0];
  const editedAudit = queryD1(`SELECT action,entity_type,entity_id,summary FROM audit_log WHERE action='progress_edited' AND entity_id=${sqlValue(updateId)}`);
  const projectActivity = queryD1(`SELECT last_activity_at FROM projects WHERE id=${sqlValue(projectId)}`)[0]?.last_activity_at;
  assert(afterEdit.content === editedContent, "author edit did not update content");
  assert(afterEdit.edited_at && afterEdit.edited_by === demo.author.id, "author edit did not write edited fields");
  assert(afterEdit.progress_snapshot === beforeEdit.progress_snapshot, "author edit changed progress_snapshot");
  assert(projectActivity === afterEdit.edited_at, "author edit did not update project last_activity_at");
  assert(editedAudit.length === 1, "progress_edited audit is missing");
  report.edit = {
    updateId,
    contentUpdated: true,
    editedAt: afterEdit.edited_at,
    editedBy: afterEdit.edited_by,
    snapshotBefore: beforeEdit.progress_snapshot,
    snapshotAfter: afterEdit.progress_snapshot,
    projectActivityUpdated: true,
    audit: editedAudit[0],
  };

  const denied = await request(`/api/progress-updates/${updateId}`, {
    cookie: otherSession.cookie,
    method: "PATCH",
    expected: 403,
    body: { content: "不應寫入" },
  });
  const afterDenied = queryD1(`SELECT content,edited_at,edited_by,progress_snapshot FROM progress_updates WHERE id=${sqlValue(updateId)}`)[0];
  assert(afterDenied.content === editedContent && afterDenied.edited_at === afterEdit.edited_at, "denied edit changed the update");
  report.permission = { status: denied.response.status, unchanged: true };

  await request(`/api/progress-updates/${updateId}`, { cookie: ownerSession.cookie, method: "DELETE" });
  const deletedCount = queryD1(`SELECT COUNT(*) AS count FROM progress_updates WHERE id=${sqlValue(updateId)}`)[0]?.count;
  const deletedAudit = queryD1(`SELECT action,entity_type,entity_id,summary FROM audit_log WHERE action='progress_deleted' AND entity_id=${sqlValue(updateId)}`);
  assert(deletedCount === 0, "owner delete left the author's update");
  assert(deletedAudit.length === 1 && String(deletedAudit[0].summary).includes(editedContent.slice(0, 40)), "progress_deleted audit summary is missing the content excerpt");
  report.deletion = { deletedCount, audit: deletedAudit[0] };

  await request(`/api/tasks/${task.body.id}`, { cookie: authorSession.cookie, method: "PATCH", body: { done: true } });
  const autoUpdate = queryD1(`SELECT id,content,progress_snapshot FROM progress_updates WHERE project_id=${sqlValue(projectId)} AND content LIKE '✔ 完成任務%' ORDER BY created_at DESC LIMIT 1`)[0];
  assert(autoUpdate?.id, "auto completion update was not generated");
  await request(`/api/progress-updates/${autoUpdate.id}`, { cookie: ownerSession.cookie, method: "DELETE" });
  const taskAfterAutoDelete = queryD1(`SELECT done FROM tasks WHERE id=${sqlValue(task.body.id)}`)[0]?.done;
  const progressAfterAutoDelete = queryD1(`SELECT progress FROM projects WHERE id=${sqlValue(projectId)}`)[0]?.progress;
  const autoRemaining = queryD1(`SELECT COUNT(*) AS count FROM progress_updates WHERE id=${sqlValue(autoUpdate.id)}`)[0]?.count;
  assert(autoRemaining === 0 && taskAfterAutoDelete === 1 && progressAfterAutoDelete === 100, "deleting auto update rolled back task or progress");
  report.autoDeletion = { updateId: autoUpdate.id, remaining: autoRemaining, taskDone: taskAfterAutoDelete, projectProgress: progressAfterAutoDelete };

  await request("/api/projects", { expected: 401 });
  const assets = await productionAssets();
  assert(assets.asset.includes("刪除後無法復原，稽核紀錄仍會保留"), "production assets lack the V12.1 delete confirmation");
  assert(assets.asset.includes("data-progress-update-edit") && assets.asset.includes("data-progress-update-delete"), "production assets lack V12.1 timeline controls");
  report.regression = {
    unauthenticated: 401,
    published: before.published.count,
    homepage: assets.homepage.status,
    title: "艾爾水晶-專案進度",
    scriptCount: assets.scriptCount,
    chunkCount: assets.chunkCount,
    timelineControls: true,
  };
} catch (error) {
  failure = error;
} finally {
  try {
    if (projectId && ownerSession) {
      await request(`/api/projects/${projectId}`, { cookie: ownerSession.cookie, method: "DELETE" }).catch(() => undefined);
    }
    cleanupFixture();
    const after = protectedSnapshots();
    const ids = demoUserList();
    const cleanupCounts = {
      projects: queryD1(`SELECT COUNT(*) AS count FROM projects WHERE owner_id=${sqlValue(demo.owner.id)}`)[0]?.count,
      users: queryD1(`SELECT COUNT(*) AS count FROM users WHERE id IN (${ids})`)[0]?.count,
      sessions: queryD1(`SELECT COUNT(*) AS count FROM sessions WHERE user_id IN (${ids})`)[0]?.count,
      audit: queryD1(`SELECT COUNT(*) AS count FROM audit_log WHERE user_id IN (${ids})`)[0]?.count,
    };
    assert(Object.values(cleanupCounts).every((count) => count === 0), `demo cleanup failed: ${JSON.stringify(cleanupCounts)}`);
    if (before) assert(JSON.stringify(after) === JSON.stringify(before), `protected production data changed: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    report.cleanup = { ...cleanupCounts, protectedBefore: before, protectedAfter: after, unchanged: !!before };
  } catch (cleanupError) {
    failure = failure ?? cleanupError;
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failure) {
  process.stderr.write(`${failure.stack ?? failure}\n`);
  process.exitCode = 1;
}
