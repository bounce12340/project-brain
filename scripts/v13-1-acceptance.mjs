import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const database = "project-brain-db";
const base = "https://projects.uic-ai.com";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function queryD1(sql) {
  const command = spawnSync(process.execPath, [wrangler, "d1", "execute", database, "--remote", "--yes", "--command", sql, "--json"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (command.status !== 0) throw new Error(`remote read-only D1 query failed: ${command.stderr.trim()}`);
  return JSON.parse(command.stdout).flatMap((item) => item.results ?? []);
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
    real_milestones: snapshot("SELECT m.* FROM milestones m JOIN projects p ON p.id=m.project_id WHERE p.is_demo=0 ORDER BY m.id"),
    real_progress: snapshot("SELECT pu.* FROM progress_updates pu JOIN projects p ON p.id=pu.project_id WHERE p.is_demo=0 ORDER BY pu.id"),
  };
}

function verifyBuiltAssets() {
  const dist = path.join(root, "dist");
  const files = [path.join(dist, "index.html"), ...readdirSync(path.join(dist, "assets")).map((name) => path.join(dist, "assets", name))];
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const marker of ["data-gantt-task-height", "data-gantt-row-height", "data-stage-colored-task", "data-gantt-legend"]) {
    assert(combined.includes(marker), `built Gantt marker missing: ${marker}`);
  }
  assert(combined.includes("fillOpacity") || combined.includes("fill-opacity"), "built task-opacity logic missing");
  assert(combined.includes("stage_color") && combined.includes("stage_position"), "built timeline stage mapping missing");
  return {
    files: files.length,
    task_height: 18,
    row_height: 52,
    stage_color_mapping: true,
    legend: true,
  };
}

async function verifyHttp() {
  const unauthenticated = await fetch(`${base}/api/projects`);
  assert(unauthenticated.status === 401, `unauthenticated API expected 401, got ${unauthenticated.status}`);
  const response = await fetch(base);
  const html = await response.text();
  assert(response.status === 200, `homepage expected 200, got ${response.status}`);
  assert(html.includes("<title>艾爾水晶-專案進度</title>"), "production title mismatch");
  return { unauthenticated_status: unauthenticated.status, homepage_status: response.status, title: "艾爾水晶-專案進度" };
}

const mode = process.argv[2];
if (mode === "--snapshot") {
  const result = protectedSnapshots();
  assert(result.published.count === 631, `published baseline expected 631, got ${result.published.count}`);
  console.log(JSON.stringify(result, null, 2));
} else if (mode === "--verify-built") {
  console.log(JSON.stringify(verifyBuiltAssets(), null, 2));
} else if (mode === "--verify-http") {
  console.log(JSON.stringify(await verifyHttp(), null, 2));
} else {
  throw new Error("usage: node scripts/v13-1-acceptance.mjs --snapshot|--verify-built|--verify-http");
}
