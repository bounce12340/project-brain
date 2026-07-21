import { randomBytes, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "https://projects.uic-ai.com";
const users = {
  ra: { id: "usr_e2e_v7_ra", email: "v7-ra@demo.local", name: "V7 Demo RA", role: "member", group: "grp_general" },
  intern: { id: "usr_e2e_v7_intern", email: "v7-intern@demo.local", name: "V7 Demo Intern", role: "intern", group: "grp_clinical" },
};
const marker = "V7E2E";
const report = { quality: {}, text: {}, pdf: {}, permission: {}, regression: {}, cleanup: false };

function sqlValue(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function runD1(sql) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "project-brain-db", "--remote", "--command", sql], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("remote D1 command failed");
}
async function passwordHash(password) {
  const salt = randomBytes(16);
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `pbkdf2$100000$${salt.toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
async function request(pathname, options = {}, expected) {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) headers.set("Origin", base);
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.arrayBuffer();
  if (expected !== undefined) assert(response.status === expected, `${pathname}: expected ${expected}, got ${response.status}, body=${body instanceof ArrayBuffer ? "<binary>" : JSON.stringify(body)}`);
  return { response, body };
}
async function login(email, password) {
  const { response } = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie?.startsWith("sid="), `missing session cookie for ${email}`);
  return cookie;
}
function auth(cookie, method = "GET", body) { return { method, headers: { Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }; }
function cleanupUsers() {
  const ids = Object.values(users).map((user) => sqlValue(user.id)).join(",");
  runD1(`DELETE FROM audit_log WHERE user_id IN (${ids}); DELETE FROM sessions WHERE user_id IN (${ids}); DELETE FROM users WHERE id IN (${ids});`);
}

let raCookie;
let failure;
try {
  cleanupUsers();
  const passwords = { ra: randomBytes(18).toString("base64url"), intern: randomBytes(18).toString("base64url") };
  const hashes = { ra: await passwordHash(passwords.ra), intern: await passwordHash(passwords.intern) };
  runD1(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,is_demo,onboarding_done,approval_status) VALUES
    (${sqlValue(users.ra.id)},${sqlValue(users.ra.email)},${sqlValue(users.ra.name)},${sqlValue(hashes.ra)},'member','grp_general',0,0,1,1,1,'approved'),
    (${sqlValue(users.intern.id)},${sqlValue(users.intern.email)},${sqlValue(users.intern.name)},${sqlValue(hashes.intern)},'intern','grp_clinical',0,0,1,1,1,'approved');`);
  raCookie = await login(users.ra.email, passwords.ra);
  const internCookie = await login(users.intern.email, passwords.intern);

  const homepage = await fetch(base);
  const html = await homepage.text();
  const unauthenticated = await request("/api/projects", {}, 401);
  const baseline = await request("/api/regwatch", auth(internCookie), 200);
  assert(homepage.status === 200 && html.includes("<title>艾爾水晶-專案進度</title>"), "title regression failed");
  assert(baseline.body.total === 627, `expected existing regwatch count 627, got ${baseline.body.total}`);
  report.regression = { homepage: homepage.status, title: true, unauthenticated: unauthenticated.response.status, regwatch_before: baseline.body.total };

  const internExtract = await request("/api/regwatch/ai-extract", auth(internCookie, "POST", { text: "民國115年7月21日測試公告" }), 403);
  report.permission = { intern_ai_extract: internExtract.response.status };

  const sourceText = `以下是兩則獨立法規公告，請各拆成一筆。\n\n民國115年7月21日，藥品查驗登記公告。標題必須是 ${marker}-TEXT-A。重點：申請資料新增安定性摘要。產品線：藥品。\n\n民國115年7月22日，醫療器材標示公告。標題必須是 ${marker}-TEXT-B。重點：外盒標示須新增製造批號。產品線：醫療器材。`;
  const extracted = await request("/api/regwatch/ai-extract", auth(raCookie, "POST", { text: sourceText, source_link: "https://example.com/v7-text" }), 200);
  assert(Array.isArray(extracted.body.entries) && extracted.body.entries.length === 2, `expected 2 extracted entries, got ${extracted.body.entries?.length}`);
  assert(extracted.body.entries.every((entry) => /^2026-07-2[12]$/.test(entry.entry_date) && ["announcement", "meeting"].includes(entry.entry_type) && entry.title.length <= 100 && entry.category.length <= 10 && entry.key_points.startsWith("•")), "text extracted fields are not compliant");
  const textBatch = await request("/api/regwatch/batch", auth(raCookie, "POST", { entries: extracted.body.entries }), 200);
  assert(textBatch.body.created === 2 && textBatch.body.skipped === 0, "text first batch stats mismatch");
  const textRepeat = await request("/api/regwatch/batch", auth(raCookie, "POST", { entries: extracted.body.entries }), 200);
  assert(textRepeat.body.created === 0 && textRepeat.body.skipped === 2, "text repeated batch stats mismatch");
  const textReadback = await request(`/api/regwatch?keyword=${marker}-TEXT`, auth(raCookie), 200);
  assert(textReadback.body.total === 2, "text entries missing from list");
  report.text = { extracted: 2, product_line_fallback: extracted.body.entries.some((entry) => entry.product_line === "其他"), first: textBatch.body, repeat: textRepeat.body, list_visible: textReadback.body.total };

  const pdfBytes = await readFile(path.join(root, "tests", "fixtures", "v7-text-layer.pdf"));
  const extractForm = new FormData();
  extractForm.set("file", new File([pdfBytes], "v7-text-layer.pdf", { type: "application/pdf" }));
  extractForm.set("source_link", "https://example.com/v7-pdf");
  const pdfExtract = await request("/api/regwatch/ai-extract", { method: "POST", headers: { Cookie: raCookie }, body: extractForm }, 200);
  assert(pdfExtract.body.entries.length === 1, `expected 1 PDF entry, got ${pdfExtract.body.entries.length}`);
  const batchForm = new FormData();
  batchForm.set("entries", JSON.stringify(pdfExtract.body.entries));
  batchForm.set("file", new File([pdfBytes], "v7-text-layer.pdf", { type: "application/pdf" }));
  const pdfBatch = await request("/api/regwatch/batch", { method: "POST", headers: { Cookie: raCookie }, body: batchForm }, 200);
  assert(pdfBatch.body.created === 1 && typeof pdfBatch.body.file_id === "string", "PDF batch did not create file_id");
  const pdfReadback = await request("/api/regwatch?year=2026", auth(raCookie), 200);
  const pdfEntry = pdfReadback.body.entries.find((entry) => entry.file_id === pdfBatch.body.file_id);
  assert(pdfEntry, "PDF entry/file readback failed");
  const download = await request(`/api/files/${pdfBatch.body.file_id}/download`, auth(internCookie), 200);
  assert(Buffer.from(download.body).equals(pdfBytes), "downloaded PDF bytes differ");
  report.pdf = { extracted: 1, created: pdfBatch.body.created, file_id_present: true, download_bytes: download.body.byteLength, bytes_equal: true };
} catch (error) {
  failure = error;
} finally {
  try {
    if (raCookie) {
      const firstPage = await request("/api/regwatch?page=1", auth(raCookie), 200);
      const createdEntries = firstPage.body.entries.filter((entry) => entry.created_by_name === users.ra.name);
      for (let page = 2; page <= firstPage.body.total_pages; page += 1) {
        const rows = await request(`/api/regwatch?page=${page}`, auth(raCookie), 200);
        createdEntries.push(...rows.body.entries.filter((entry) => entry.created_by_name === users.ra.name));
      }
      for (const entry of createdEntries) await request(`/api/regwatch/${entry.id}`, auth(raCookie, "DELETE"), 200);
      const afterEntries = await request(`/api/regwatch?keyword=${marker}`, auth(raCookie), 200);
      const afterAll = await request("/api/regwatch", auth(raCookie), 200);
      assert(afterEntries.body.total === 0, `cleanup left ${afterEntries.body.total} V7 entries`);
      assert(afterAll.body.total === 627, `regwatch count after cleanup is ${afterAll.body.total}`);
      report.regression.regwatch_after = afterAll.body.total;
    }
    cleanupUsers();
    report.cleanup = true;
  } catch (error) { report.cleanup = false; failure ??= error; }
}

if (failure) report.error = failure.message;
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
