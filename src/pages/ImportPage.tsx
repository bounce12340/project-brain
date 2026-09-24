import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatDate } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";
import { aiInstructions, previewPayload, templateSheets, workbookToPayload, type ConversionResult, type ImportContext, type Issue } from "../import-sheet";
import { readXlsx, writeXlsx } from "../xlsx";
import type { Metadata, Project } from "../types";

interface Stats {
  projects: { created: number; updated: number };
  tasks: { created: number; skipped: number };
  milestones: { created: number; skipped: number };
  events: { created: number; skipped: number };
  progress_updates: { created: number; skipped: number };
  warnings: string[];
}
type Check = { ok: true; summary: Stats } | { ok: false; issues: string[] };
type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn" | "failed";
interface ImportRequest {
  id: string; status: RequestStatus; source_name: string; created_at: string; submitted_by: string; submitter_name: string;
  reviewer_name: string | null; reviewed_at: string | null; review_note: string; summary: Stats | null; result: Stats | null;
  payload?: { projects?: Array<Record<string, unknown>> };
}

/** api() 只留下錯誤訊息；這裡需要 422 回應裡的 issues 清單，所以自己送。 */
async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`/api${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

const issuesOf = (body: Record<string, unknown>): string[] => Array.isArray(body.issues) ? body.issues as string[] : [String(body.error ?? "HTTP error")];
const failure = (body: Record<string, unknown>): Check => ({ ok: false, issues: issuesOf(body) });
/** 一個問題寫成一行，給紀錄用：「工作項目 第 8 列 類型（B 欄）：…」。 */
const describeIssue = (issue: Issue) => [issue.sheet, issue.row ? `第 ${issue.row} 列` : "", issue.column ?? ""].filter(Boolean).join(" ") + (issue.sheet || issue.row || issue.column ? "：" : "") + issue.message;

export function ImportPage() {
  const t = useT(); const { lang } = useLang(); const { user } = useAuth();
  const [params] = useSearchParams();
  const isAdmin = user?.role === "admin";
  const [context, setContext] = useState<ImportContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [copyNote, setCopyNote] = useState("");
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [conversion, setConversion] = useState<ConversionResult | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"" | "submitted" | "imported">("");
  const [requests, setRequests] = useState<ImportRequest[] | null>(null);

  const loadRequests = () => api<{ requests: ImportRequest[] }>("/import/requests").then((data) => setRequests(data.requests)).catch(() => setRequests([]));
  useEffect(() => {
    Promise.all([api<Metadata>("/metadata"), api<{ projects: Array<Project & { external_key?: string | null }> }>("/projects")])
      .then(([meta, list]) => setContext({
        groups: meta.groups.map(({ id, name }) => ({ id, name })),
        users: meta.users.map(({ name, email }) => ({ name, email })),
        me: { name: user?.name ?? "", email: user?.email ?? "", group_name: user?.group_name ?? "" },
        existingProjects: list.projects.map(({ name, external_key }) => ({ name, external_key })),
      }))
      .catch((cause) => setLoadError(cause instanceof Error ? cause.message : String(cause)));
    void loadRequests();
  }, []);

  const errors = conversion?.issues.filter((issue) => issue.level === "error") ?? [];
  const warnings = conversion?.issues.filter((issue) => issue.level === "warning") ?? [];
  const canSubmit = !!conversion && !errors.length && check?.ok === true && !submitting;

  const download = () => {
    if (!context) return;
    const blob = new Blob([writeXlsx(templateSheets(context)) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "艾爾水晶-批次匯入範本.xlsx"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyInstructions = async () => {
    if (!context) return;
    try { await navigator.clipboard.writeText(aiInstructions(context).join("\n")); setCopyNote(t("import.copied")); }
    catch { setCopyNote(t("import.copyFailed")); }
  };

  /** 檢查沒過就回報給伺服器記下來，管理員才查得到誰卡在哪裡。回報失敗不影響畫面。 */
  const reportFailure = (sourceName: string, messages: string[]) => {
    if (messages.length) void post("/import/check-failed", { source_name: sourceName, messages }).catch(() => undefined);
  };

  const serverCheck = async (payload: unknown, sourceName: string) => {
    setChecking(true);
    try {
      const response = await post("/import/validate", { payload, source_name: sourceName });
      setCheck(response.status === 200 ? { ok: true, summary: response.body.summary as Stats } : failure(response.body));
    } finally { setChecking(false); }
  };

  /** 選好檔案當下就檢查：先在瀏覽器逐列檢查格式，沒有錯誤再請伺服器核對權限與既有專案。 */
  const onFile = async (file: File | undefined) => {
    if (!file || !context) return;
    setFileName(file.name); setFileError(""); setConversion(null); setCheck(null); setDone(""); setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let result: ConversionResult;
      if (/\.json$/i.test(file.name)) {
        let payload: unknown;
        try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { setFileError(t("import.jsonError")); reportFailure(file.name, [t("import.jsonError")]); return; }
        result = { payload: payload as ConversionResult["payload"], issues: [], projects: previewPayload(payload, context) };
      } else {
        result = workbookToPayload(await readXlsx(bytes), context);
      }
      setConversion(result);
      const errors = result.issues.filter((issue) => issue.level === "error");
      if (!errors.length) await serverCheck(result.payload, file.name);
      else reportFailure(file.name, errors.map(describeIssue));
    } catch (cause) {
      const message = t("import.fileError", { message: cause instanceof Error ? cause.message : String(cause) });
      setFileError(message);
      reportFailure(file.name, [message]);
    } finally { setReading(false); }
  };

  const submit = async () => {
    if (!conversion) return;
    setSubmitting(true);
    try {
      const response = await post("/import", { source_name: fileName, payload: conversion.payload });
      if (response.status === 200 || response.status === 201) {
        setDone(response.body.status === "applied" ? "imported" : "submitted");
        setConversion(null); setCheck(null);
        void loadRequests();
      } else setCheck(failure(response.body));
    } finally { setSubmitting(false); }
  };

  if (loadError) return <ErrorBox message={loadError} />;
  if (!context) return <Loading />;
  return <>
    <PageHeader title={t("import.title")} description={`${t("import.description")} ${t(isAdmin ? "import.adminNote" : "import.reviewNote")}`} />

    <section className="panel mb-5">
      <h2 className="font-bold">{t("import.step1")}</h2>
      <p className="mt-1 text-sm text-star-dim">{t("import.step1Text")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className="btn" onClick={download}>{t("import.download")}</button>
        <button type="button" className="btn-secondary" onClick={() => void copyInstructions()}>{t("import.copyAi")}</button>
      </div>
      {copyNote && <p className="mt-2 text-sm text-psi" role="status">{copyNote}</p>}
    </section>

    <section className="panel mb-5">
      <h2 className="font-bold">{t("import.step2")}</h2>
      <label className="btn-secondary mt-3 inline-flex cursor-pointer">
        <span>{t("import.choose")}</span>
        <input className="sr-only" type="file" accept=".xlsx,.json" onChange={(event) => { void onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </label>
      {fileName && <p className="mt-2 text-sm text-star-dim">{t("import.fileLabel", { name: fileName })}</p>}
      {reading && <p className="mt-2 text-sm text-star-dim" role="status">{t("import.reading")}</p>}
      {fileError && <div className="mt-3"><ErrorBox message={fileError} /></div>}
      {done && <p className="mt-3 border border-ok p-3 text-sm text-ok" role="status">{t(done === "imported" ? "import.imported" : "import.submitted")}</p>}
    </section>

    {conversion && <section className="panel mb-5 space-y-4" aria-live="polite">
      <h2 className="font-bold">{t("import.step3")}</h2>
      <p className={`text-sm ${errors.length ? "text-danger" : "text-ok"}`}>{errors.length || warnings.length ? t("import.problemCount", { errors: errors.length, warnings: warnings.length }) : t("import.noProblems")}</p>
      {conversion.issues.length > 0 && <IssueTable issues={conversion.issues} />}
      {conversion.projects.length > 0 && <ProjectTable projects={conversion.projects} />}
      {checking && <p className="text-sm text-star-dim" role="status">{t("import.serverChecking")}</p>}
      {check && <CheckResult check={check} okLabel="import.serverOk" failLabel="import.serverFailed" />}
      <button type="button" className="btn" disabled={!canSubmit} onClick={() => void submit()}>{submitting ? t("import.submitting") : t(isAdmin ? "import.importNow" : "import.submit")}</button>
    </section>}

    {isAdmin && <CheckFailures lang={lang} />}

    <section className="panel">
      <h2 className="mb-3 font-bold">{t(isAdmin ? "import.requests" : "import.myRequests")}</h2>
      {!requests ? <Loading /> : requests.length ? <div className="space-y-3">
        {[...requests].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending")).map((request) =>
          <RequestItem key={request.id} request={request} isAdmin={isAdmin} lang={lang} autoOpen={params.get("request") === request.id} onChanged={() => void loadRequests()} />)}
      </div> : <Empty>{t("import.noRequests")}</Empty>}
    </section>
  </>;
}

function IssueTable({ issues }: { issues: Issue[] }) {
  const t = useT();
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
    <thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2 pr-3">{t("import.col.sheet")}</th><th className="pr-3">{t("import.col.row")}</th><th className="pr-3">{t("import.col.column")}</th><th>{t("import.col.problem")}</th></tr></thead>
    <tbody>{[...issues].sort((a, b) => Number(a.level === "warning") - Number(b.level === "warning")).map((issue, index) => <tr key={index} className="border-b border-nexus-line align-top">
      <td className="py-2 pr-3">{issue.sheet || "—"}</td><td className="pr-3">{issue.row ?? "—"}</td><td className="pr-3">{issue.column ?? "—"}</td>
      <td className={issue.level === "error" ? "text-danger" : "text-warn"}><span className="mr-2 font-semibold">{t(issue.level === "error" ? "import.level.error" : "import.level.warning")}</span>{issue.message}</td>
    </tr>)}</tbody>
  </table></div>;
}

function ProjectTable({ projects }: { projects: ConversionResult["projects"] }) {
  const t = useT();
  return <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
    <thead><tr className="border-b border-nexus-line text-gold-bright">{(["import.col.project", "import.col.kind", "import.col.tasks", "import.col.milestones", "import.col.events", "import.col.updates"] as TransKey[]).map((key) => <th key={key} className="py-2 pr-3">{t(key)}</th>)}</tr></thead>
    <tbody>{projects.map((project) => <tr key={project.name} className="border-b border-nexus-line">
      <td className="py-2 pr-3 font-medium">{project.name}</td>
      <td className="pr-3"><span className={`badge ${project.missing ? "text-danger" : project.isNew ? "text-psi" : ""}`}>{t(project.missing ? "import.missing" : project.isNew ? "import.new" : "import.existing")}</span></td>
      <td className="pr-3">{project.tasks}</td><td className="pr-3">{project.milestones}</td><td className="pr-3">{project.events}</td><td>{project.updates}</td>
    </tr>)}</tbody>
  </table></div>;
}

function CheckResult({ check, okLabel, failLabel }: { check: Check; okLabel: TransKey; failLabel: TransKey }) {
  const t = useT();
  if (!check.ok) return <div className="border border-danger p-3 text-sm text-danger"><p className="font-semibold">{t(failLabel)}</p><ul className="mt-2 list-disc space-y-1 pl-5">{check.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>;
  const { summary } = check;
  return <div className="border border-ok p-3 text-sm">
    <p className="font-semibold text-ok">{t(okLabel)}</p>
    <p className="mt-1">{t("import.effect", { pc: summary.projects.created, pu: summary.projects.updated, t: summary.tasks.created, m: summary.milestones.created, e: summary.events.created, u: summary.progress_updates.created })}</p>
    {summary.tasks.skipped + summary.milestones.skipped + summary.events.skipped + summary.progress_updates.skipped > 0 && <p className="mt-1 text-star-dim">{t("import.skipped", { t: summary.tasks.skipped, m: summary.milestones.skipped, e: summary.events.skipped, u: summary.progress_updates.skipped })}</p>}
    {summary.warnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-warn">{summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
  </div>;
}

const statusTone: Record<RequestStatus, string> = { pending: "text-warn", approved: "text-ok", rejected: "text-danger", withdrawn: "text-star-dim", failed: "text-danger" };

function RequestItem({ request, isAdmin, lang, autoOpen, onChanged }: { request: ImportRequest; isAdmin: boolean; lang: "zh" | "en"; autoOpen: boolean; onChanged(): void }) {
  const t = useT();
  const [open, setOpen] = useState(autoOpen);
  const [detail, setDetail] = useState<{ request: ImportRequest; check?: Check } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = request.status === "pending" || request.status === "failed";
  useEffect(() => {
    if (!open || detail) return;
    api<{ request: ImportRequest; check?: Check }>(`/import/requests/${request.id}`).then(setDetail).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [open, detail]);
  useEffect(() => { if (autoOpen) document.getElementById(`import-${request.id}`)?.scrollIntoView({ block: "start" }); }, [autoOpen]);

  const act = async (action: "approve" | "reject" | "withdraw") => {
    let body: unknown;
    if (action === "approve" && !window.confirm(t("import.approveConfirm", { name: request.submitter_name }))) return;
    if (action === "withdraw" && !window.confirm(t("import.withdrawConfirm"))) return;
    if (action === "reject") { const note = window.prompt(t("import.rejectPrompt")); if (note === null) return; body = { note }; }
    setBusy(true); setError("");
    try {
      const response = await post(`/import/requests/${request.id}/${action}`, body ?? {});
      // 失敗時清掉明細重新抓：核准被擋通常是資料在送出後變了，要看到最新的檢查結果。
      if (response.status >= 400) { setError(issuesOf(response.body).join("；")); setDetail(null); }
      else onChanged();
    } finally { setBusy(false); }
  };

  const summary = request.result ?? request.summary;
  return <article id={`import-${request.id}`} className={`border p-3 ${request.status === "pending" ? "border-warn/70" : "border-nexus-line"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{request.source_name || t("import.untitledFile")} <span className={`ml-2 text-sm font-semibold ${statusTone[request.status]}`}>{t(`import.status.${request.status}` as TransKey)}</span></p>
        <p className="mt-1 text-xs text-star-dim">{t("import.submittedBy", { name: request.submitter_name, date: formatDate(request.created_at, true, lang) })}
          {request.reviewer_name && request.reviewed_at && ` · ${t("import.reviewedBy", { name: request.reviewer_name, date: formatDate(request.reviewed_at, true, lang) })}`}</p>
        {summary && <p className="mt-1 text-sm">{t("import.effect", { pc: summary.projects.created, pu: summary.projects.updated, t: summary.tasks.created, m: summary.milestones.created, e: summary.events.created, u: summary.progress_updates.created })}</p>}
        {request.review_note && <p className="mt-1 text-sm text-warn">{t("import.noteLabel", { note: request.review_note })}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary !py-1.5 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "import.hide" : "import.open")}</button>
        {!isAdmin && request.status === "pending" && <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={busy} onClick={() => void act("withdraw")}>{t("import.withdraw")}</button>}
      </div>
    </div>
    {error && <div className="mt-3"><ErrorBox message={error} /></div>}
    {open && <div className="mt-3 space-y-3 border-t border-nexus-line pt-3">
      {!detail ? <Loading /> : <>
        {detail.check && <CheckResult check={detail.check} okLabel="import.recheckOk" failLabel="import.recheckFailed" />}
        <ImportContents payload={detail.request.payload} />
        {isAdmin && pending && <div className="flex flex-wrap gap-3">
          <button type="button" className="btn" disabled={busy || detail.check?.ok === false} onClick={() => void act("approve")}>{t("import.approve")}</button>
          <button type="button" className="btn-danger" disabled={busy} onClick={() => void act("reject")}>{t("import.reject")}</button>
        </div>}
      </>}
    </div>}
  </article>;
}

/** 管理員核准前看得到每一筆要寫進去的內容，不是只有數字。 */
function ImportContents({ payload }: { payload?: { projects?: Array<Record<string, unknown>> } }) {
  const t = useT();
  const projects = useMemo(() => Array.isArray(payload?.projects) ? payload.projects : [], [payload]);
  const list = (value: unknown) => Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
  const text = (value: unknown) => typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  return <div className="space-y-4">{projects.map((project, index) => {
    const status = text(project.status);
    const span = [text(project.start_date), text(project.target_date)];
    const meta = [
      project.external_key && t("import.projectCode", { code: text(project.external_key) }), text(project.group),
      ["active", "paused", "done", "archived"].includes(status) ? t(`status.${status}` as TransKey) : status,
      span[0] && span[1] ? `${span[0]} → ${span[1]}` : span[0] || span[1],
    ].filter(Boolean).join(" · ");
    const rows: Array<[string, string, string]> = [
      ...list(project.tasks).map((item): [string, string, string] => [t("import.col.tasks"), `${item.done ? "✔ " : ""}${text(item.title)}${item.stage ? `（${text(item.stage)}）` : ""}${item.assignee_email ? ` · ${text(item.assignee_email)}` : ""}`, [text(item.start_date), text(item.due_date)].filter(Boolean).join(" → ")]),
      ...list(project.milestones).map((item): [string, string, string] => [t("import.col.milestones"), `${item.done ? "✔ " : ""}${text(item.title)}`, [text(item.due_date), text(item.end_date)].filter(Boolean).join(" → ")]),
      ...list(project.events).map((item): [string, string, string] => [t("import.col.events"), text(item.title), [text(item.due_date), text(item.end_date)].filter(Boolean).join(" → ")]),
      ...list(project.progress_updates).map((item): [string, string, string] => [t("import.col.updates"), text(item.content), text(item.date)]),
    ];
    return <div key={index} className="border border-nexus-line p-3">
      <p className="font-medium">{text(project.name) || text(project.external_key)}</p>
      {meta && <p className="text-xs text-star-dim">{meta}</p>}
      {text(project.goal_summary) && <p className="mt-1 text-sm text-star-dim">{text(project.goal_summary)}</p>}
      {rows.length > 0 && <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><tbody>{rows.map(([kind, title, dates], row) =>
        <tr key={row} className="border-t border-nexus-line align-top"><td className="w-20 py-1.5 pr-3 text-xs text-star-dim">{kind}</td><td className="whitespace-pre-wrap break-words pr-3">{title}</td><td className="w-44 whitespace-nowrap text-xs text-star-dim">{dates}</td></tr>)}</tbody></table></div>}
    </div>;
  })}</div>;
}

/** 管理員看得到誰的上傳卡在檢查、卡在哪幾個問題，不必再請對方截圖。 */
function CheckFailures({ lang }: { lang: "zh" | "en" }) {
  const t = useT();
  const [failures, setFailures] = useState<Array<{ id: string; created_at: string; summary: string; user_name: string | null }> | null>(null);
  useEffect(() => { api<{ failures: Array<{ id: string; created_at: string; summary: string; user_name: string | null }> }>("/import/check-failures").then((data) => setFailures(data.failures)).catch(() => setFailures([])); }, []);
  if (!failures) return null;
  return <section className="panel mb-5">
    <h2 className="font-bold">{t("import.failures")}</h2>
    <p className="mt-1 text-sm text-star-dim">{t("import.failuresHint")}</p>
    {failures.length ? <div className="mt-3 space-y-3">{failures.map((item) => <article key={item.id} className="border border-nexus-line p-3">
      <p className="text-xs text-star-dim">{t("import.failureBy", { name: item.user_name ?? "—", date: formatDate(item.created_at, true, lang) })}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.summary}</p>
    </article>)}</div> : <p className="mt-3 text-sm text-star-dim">{t("import.noFailures")}</p>}
  </section>;
}
