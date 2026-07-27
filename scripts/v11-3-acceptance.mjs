import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const database = "project-brain-db";
const demoUser = {
  id: "usr_e2e_v11_3_reader",
  email: "v11-3-reader@demo.local",
  name: "V11.3 Demo Reader",
};
const report = {
  baseline: {},
  filters: {},
  assets: {},
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
  };
}

function cleanupFixture() {
  const userId = sqlValue(demoUser.id);
  runD1(`PRAGMA foreign_keys=ON;
    DELETE FROM sessions WHERE user_id=${userId};
    DELETE FROM users WHERE id=${userId};`);
}

async function request(pathname, cookie, expected) {
  const response = await fetch(`${base}${pathname}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const body = await response.json().catch(() => ({}));
  assert(
    response.status === expected,
    `${pathname}: expected ${expected}, got ${response.status}, body=${JSON.stringify(body)}`,
  );
  return { response, body };
}

let failure;
let before;
try {
  cleanupFixture();
  before = protectedSnapshots();
  report.baseline = before;

  const token = randomBytes(32).toString("base64url");
  const sessionId = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  runD1(`INSERT INTO users
      (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status)
      VALUES (${sqlValue(demoUser.id)},${sqlValue(demoUser.email)},${sqlValue(demoUser.name)},'v11-3-e2e-session-only','member','grp_general',0,0,1,1,1,'approved');
    INSERT INTO sessions(id,user_id,expires_at)
      VALUES (${sqlValue(sessionId)},${sqlValue(demoUser.id)},${sqlValue(expiresAt)});`);
  const cookie = `sid=${token}`;

  const d1July2026 = queryD1(
    "SELECT COUNT(*) AS count FROM reg_entries WHERE status='published' AND substr(entry_date,1,7)='2026-07'",
  )[0]?.count;
  const d1Published = queryD1(
    "SELECT COUNT(*) AS count FROM reg_entries WHERE status='published'",
  )[0]?.count;
  const yearMonth = await request("/api/regwatch?year=2026&month=7", cookie, 200);
  const monthOnly = await request("/api/regwatch?month=7", cookie, 200);
  const unfiltered = await request("/api/regwatch", cookie, 200);
  assert(yearMonth.body.total === d1July2026, `year+month API ${yearMonth.body.total} != D1 ${d1July2026}`);
  assert(unfiltered.body.total === d1Published, `unfiltered API ${unfiltered.body.total} != D1 ${d1Published}`);
  assert(
    JSON.stringify(monthOnly.body) === JSON.stringify(unfiltered.body),
    "month without year differs from unfiltered response",
  );
  report.filters = {
    api_year_2026_month_7: yearMonth.body.total,
    d1_year_2026_month_7: d1July2026,
    month_without_year_matches_unfiltered: true,
    published_total: d1Published,
  };

  await request("/api/regwatch", "", 401);
  const homepage = await fetch(base);
  const html = await homepage.text();
  assert(homepage.status === 200, `homepage expected 200, got ${homepage.status}`);
  assert(html.includes("<title>艾爾水晶-專案進度</title>"), "production title smoke failed");
  const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  assert(scriptPaths.length > 0, "production HTML has no JavaScript asset");
  const scripts = await Promise.all(scriptPaths.map(async (scriptPath) => {
    const response = await fetch(new URL(scriptPath, base));
    assert(response.ok, `could not fetch production asset ${scriptPath}`);
    return response.text();
  }));
  const builtAsset = scripts.join("\n");
  assert(builtAsset.includes("全部月份") && builtAsset.includes("All months"), "month dropdown labels missing from built asset");
  assert(/disabled:![\w$]+\.year/.test(builtAsset), "month disabled logic missing from built asset");
  report.assets = {
    script_count: scriptPaths.length,
    month_labels: true,
    disabled_when_year_empty: true,
  };

  const during = protectedSnapshots();
  for (const key of Object.keys(before)) {
    assert(during[key].fingerprint === before[key].fingerprint, `${key} changed during E2E`);
  }
  report.regression = {
    unauthenticated: 401,
    homepage: homepage.status,
    title: "艾爾水晶-專案進度",
    drafts_unchanged_during: true,
    published_unchanged_during: true,
    tombstones_unchanged_during: true,
  };
} catch (error) {
  failure = error;
} finally {
  try {
    cleanupFixture();
    const after = protectedSnapshots();
    const remaining = queryD1(`SELECT
      (SELECT COUNT(*) FROM users WHERE id=${sqlValue(demoUser.id)}) AS users,
      (SELECT COUNT(*) FROM sessions WHERE user_id=${sqlValue(demoUser.id)}) AS sessions`)[0];
    assert(remaining.users === 0 && remaining.sessions === 0, `fixture cleanup mismatch: ${JSON.stringify(remaining)}`);
    if (before) {
      for (const key of Object.keys(before)) {
        assert(after[key].fingerprint === before[key].fingerprint, `${key} changed after cleanup`);
      }
    }
    report.regression = {
      ...report.regression,
      final_drafts: after.drafts.count,
      final_published: after.published.count,
      final_tombstones: after.tombstones.count,
      protected_fingerprints_unchanged_after: before
        ? Object.keys(before).every((key) => after[key].fingerprint === before[key].fingerprint)
        : null,
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
