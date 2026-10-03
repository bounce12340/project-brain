import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, jsonBody, patchBody } from "../api";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";
import { categoryMatches, cleanCategoryFilter, cleanMonth, COURSE_CATEGORIES, formatRecordTime, inMonthRange, monthPresets, normalizeRange, rangeLabel, recordMatches, recordsReport, recordYears, splitRecords, taipeiNowLocal, type CategoryFilter, type MeetingRecord, type MonthRange, type RecordKind } from "../meeting-records";
import type { Project } from "../types";

/** 會議記錄與公司外訓共用這一頁；差在文字、會議可掛專案、外訓多了分類與主辦單位。 */
interface Draft { title: string; starts_at: string; ends_at: string; location: string; attendees: string; organizer: string; category: string; summary: string; project_id: string }
const EMPTY: Draft = { title: "", starts_at: "", ends_at: "", location: "", attendees: "", organizer: "", category: "", summary: "", project_id: "" };

const COPY: Record<RecordKind, Record<"title" | "description" | "add" | "newTitle" | "editTitle" | "name" | "namePlaceholder" | "attendees" | "attendeesPlaceholder" | "summary" | "summaryPlaceholder" | "empty", TransKey>> = {
  meeting: {
    title: "meetings.title", description: "meetings.description", add: "meetings.add", newTitle: "meetings.newTitle", editTitle: "meetings.editTitle", name: "meetings.name", namePlaceholder: "meetings.namePlaceholder",
    attendees: "meetings.attendees", attendeesPlaceholder: "meetings.attendeesPlaceholder", summary: "meetings.summary", summaryPlaceholder: "meetings.summaryPlaceholder", empty: "meetings.empty",
  },
  course: {
    title: "courses.title", description: "courses.description", add: "courses.add", newTitle: "courses.newTitle", editTitle: "courses.editTitle", name: "courses.name", namePlaceholder: "courses.namePlaceholder",
    attendees: "courses.attendees", attendeesPlaceholder: "courses.attendeesPlaceholder", summary: "courses.summary", summaryPlaceholder: "courses.summaryPlaceholder", empty: "courses.empty",
  },
};

/** 摘要超過這麼多行或字就先收起來。 */
const SUMMARY_PREVIEW_LINES = 6;
const SUMMARY_PREVIEW_CHARS = 280;

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const monthName = (month: string, lang: "zh" | "en") => new Intl.DateTimeFormat(lang === "zh" ? "zh-TW" : "en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, Number(month) - 1, 1)));
const categoryKey = (code: string) => `category.${code}` as TransKey;
const sameRange = (a: MonthRange, b: MonthRange) => { const x = normalizeRange(a); const y = normalizeRange(b); return x.from === y.from && x.to === y.to; };

export function MeetingsPage() { return <RecordsPage kind="meeting" />; }
export function CoursesPage() { return <RecordsPage kind="course" />; }

function RecordsPage({ kind }: { kind: RecordKind }) {
  const t = useT(); const { lang } = useLang(); const location = useLocation();
  const copy = COPY[kind];
  const [records, setRecords] = useState<MeetingRecord[] | null>(null);
  const [projects, setProjects] = useState<Array<Pick<Project, "id" | "name">>>([]);
  const [query, setQuery] = useState("");
  // 年月範圍放在網址上（?from=2026-10&to=2026-10），重新整理或把連結傳給別人都還是同一段期間。
  const [params, setParams] = useSearchParams();
  const range = useMemo<MonthRange>(() => ({ from: cleanMonth(params.get("from")), to: cleanMonth(params.get("to")) }), [params]);
  // 分類只有外訓有（?category=drug，還沒分類的是 none）。
  const category: CategoryFilter = kind === "course" ? cleanCategoryFilter(params.get("category")) : null;
  const [copyNote, setCopyNote] = useState(""); const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft; projectName: string | null } | null>(null);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => api<{ meetings: MeetingRecord[] }>(`/meetings?kind=${kind}`).then((data) => setRecords(data.meetings)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("error.operation")));
  useEffect(() => { setRecords(null); setEditing(null); setQuery(""); setMessage(""); setError(""); setCopyNote(""); setCopyFallback(null); void load(); }, [kind]);
  // 會議可以掛在進行中或暫停的專案底下。
  useEffect(() => { if (kind === "meeting") api<{ projects: Project[] }>("/projects?status=active,paused").then((data) => setProjects(data.projects.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")))).catch(() => undefined); }, [kind]);
  // 從首頁點進來時帶 #id：載入後捲到那一筆。
  useEffect(() => { if (records && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "center" }); }, [records, location.hash]);

  const shown = useMemo(() => (records ?? []).filter((record) => recordMatches(record, query) && inMonthRange(record, range) && categoryMatches(record, category)), [records, query, range, category]);
  const { upcoming, past } = useMemo(() => splitRecords(shown, taipeiNowLocal()), [shown]);

  const setRange = (next: MonthRange) => {
    const updated = new URLSearchParams(params);
    for (const end of ["from", "to"] as const) { const value = next[end]; if (value) updated.set(end, value); else updated.delete(end); }
    setParams(updated, { replace: true }); setCopyNote(""); setCopyFallback(null);
  };
  const setCategory = (next: string) => {
    const updated = new URLSearchParams(params);
    if (next) updated.set("category", next); else updated.delete("category");
    setParams(updated, { replace: true }); setCopyNote(""); setCopyFallback(null);
  };
  const categoryName = (code: string) => code === "none" ? t("records.uncategorized") : t(categoryKey(code));
  const ranged = Boolean(range.from || range.to);
  const now = taipeiNowLocal();
  const presets = monthPresets(now);
  const years = [...new Set([...recordYears(records ?? [], now), ...[range.from, range.to].flatMap((value) => value ? [value.slice(0, 4)] : [])])].sort((a, b) => b.localeCompare(a));
  const periodLabel = rangeLabel(range, lang);

  // 複製成一行一筆的清單，月報或 email 直接貼上；瀏覽器不給用剪貼簿時，把清單放在方框裡讓人手動選。
  const copyList = async () => {
    const title = category ? t("records.titleWithCategory", { title: t(copy.title), category: categoryName(category) }) : t(copy.title);
    const heading = periodLabel ? t("records.reportHeading", { title, range: periodLabel, count: shown.length }) : t("records.reportHeadingAll", { title, count: shown.length });
    const categoryNames = Object.fromEntries(COURSE_CATEGORIES.map((code) => [code, categoryName(code)]));
    const report = recordsReport(shown, heading, { organizer: t("courses.organizer"), location: t("records.location"), attendees: t(copy.attendees), project: t("meetings.project"), category: t("courses.category"), categoryNames }, lang);
    try { await navigator.clipboard.writeText(report); setCopyFallback(null); setCopyNote(t("records.copied", { count: shown.length })); }
    catch { setCopyFallback(report); setCopyNote(t("records.copyFailed")); }
  };

  const monthPicker = (end: "from" | "to") => {
    const value = range[end]; const year = value?.slice(0, 4) ?? ""; const month = value?.slice(5, 7) ?? "";
    // 只選年份時，起從 1 月、迄到 12 月，選「2026 至 2026」就是整年。
    const defaultMonth = end === "from" ? "01" : "12";
    return <span className="flex items-center gap-1">
      <select aria-label={t(end === "from" ? "records.fromYear" : "records.toYear")} value={year} onChange={(event) => setRange({ ...range, [end]: event.target.value ? `${event.target.value}-${month || defaultMonth}` : null })}>
        <option value="">{t("records.anyYear")}</option>
        {years.map((option) => <option key={option} value={option}>{t("records.yearOption", { year: option })}</option>)}
      </select>
      <select aria-label={t(end === "from" ? "records.fromMonth" : "records.toMonth")} value={month} disabled={!year} onChange={(event) => setRange({ ...range, [end]: `${year}-${event.target.value}` })}>
        {!year && <option value="">—</option>}
        {MONTHS.map((option) => <option key={option} value={option}>{monthName(option, lang)}</option>)}
      </select>
    </span>;
  };
  const preset = (label: TransKey, value: MonthRange) => <button key={label} type="button" className="filter-chip" aria-pressed={sameRange(range, value)} onClick={() => setRange(value)}>{t(label)}</button>;

  const filters = records && records.length > 0 && <div className="mb-5 space-y-3 border-y border-nexus-line py-3">
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <legend className="sr-only">{t("records.period")}</legend>
      <span aria-hidden="true" className="text-sm font-semibold text-star-dim">{t("records.period")}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-2">{monthPicker("from")}<span className="text-sm text-star-dim">{t("records.rangeTo")}</span>{monthPicker("to")}</span>
      <span className="flex flex-wrap gap-1.5">{preset("records.thisMonth", presets.thisMonth)}{preset("records.lastMonth", presets.lastMonth)}{preset("records.thisYear", presets.thisYear)}{preset("records.allTime", { from: null, to: null })}</span>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3">
      {kind === "course" && <select aria-label={t("records.categoryFilter")} value={category ?? ""} onChange={(event) => setCategory(event.target.value)}>
        <option value="">{t("records.allCategories")}</option>
        {COURSE_CATEGORIES.map((code) => <option key={code} value={code}>{categoryName(code)}</option>)}
        <option value="none">{t("records.uncategorized")}</option>
      </select>}
      <input aria-label={t("records.search")} className="min-w-0 flex-1 basis-56" type="search" placeholder={t("records.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
      <span className="text-sm text-star-dim">{periodLabel ? t("records.countInRange", { range: periodLabel, shown: shown.length, total: records.length }) : t(query.trim() || category ? "records.countFiltered" : "records.count", { shown: shown.length, total: records.length })}</span>
      <button type="button" className="btn-secondary" disabled={!shown.length} title={t("records.copyHint")} onClick={() => void copyList()}>{t("records.copyList")}</button>
    </div>
    {copyNote && <p role="status" className={`text-sm ${copyFallback ? "text-warn" : "text-ok"}`}>{copyNote}</p>}
    {copyFallback && <textarea aria-label={t("records.copyList")} className="w-full font-mono text-xs" rows={Math.min(12, copyFallback.split("\n").length + 1)} readOnly value={copyFallback} onFocus={(event) => event.currentTarget.select()} />}
  </div>;

  const openForm = (id: string | null, draft: Draft, projectName: string | null = null) => {
    setError(""); setMessage(""); setEditing({ id, draft, projectName });
    window.setTimeout(() => { document.getElementById("record-form-title")?.scrollIntoView({ block: "start" }); document.getElementById("record-title")?.focus({ preventScroll: true }); }, 0);
  };
  const startNew = () => openForm(null, { ...EMPTY });
  const startEdit = (record: MeetingRecord) => openForm(record.id, {
    title: record.title, starts_at: record.starts_at, ends_at: record.ends_at ?? "", location: record.location, attendees: record.attendees,
    organizer: record.organizer, category: record.category ?? "", summary: record.summary, project_id: record.project_id ?? "",
  }, record.project_name);
  const setField = (key: keyof Draft, value: string) => setEditing((current) => current && { ...current, draft: { ...current.draft, [key]: value } });

  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editing) return; setBusy(true); setError("");
    const { draft } = editing;
    const body = { title: draft.title, starts_at: draft.starts_at, ends_at: draft.ends_at || null, location: draft.location, attendees: draft.attendees, summary: draft.summary, ...(kind === "meeting" ? { project_id: draft.project_id || null } : { organizer: draft.organizer, category: draft.category }) };
    try {
      if (editing.id) await api(`/meetings/${editing.id}`, patchBody(body)); else await api("/meetings", jsonBody({ kind, ...body }));
      // 先重新載入清單再顯示訊息，看到「已新增」時清單裡就已經有那一筆。
      await load(); setEditing(null); setMessage(t(editing.id ? "records.updated" : "records.added", { title: draft.title.trim() }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.operation")); } finally { setBusy(false); }
  };
  const remove = async (record: MeetingRecord) => {
    if (!window.confirm(t("records.deleteConfirm", { title: record.title }))) return;
    setError(""); setMessage("");
    try { await api(`/meetings/${record.id}`, { method: "DELETE" }); await load(); setMessage(t("records.deleted", { title: record.title })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("error.operation")); }
  };

  // 編輯一筆掛在已結束專案底下的會議時，那個專案不在「進行中」清單裡：仍要列出來，否則存檔會被當成清掉。
  const projectOptions = editing?.draft.project_id && !projects.some((project) => project.id === editing.draft.project_id)
    ? [...projects, { id: editing.draft.project_id, name: editing.projectName ?? editing.draft.project_id }] : projects;

  const form = editing && <form className="panel mb-6" onSubmit={save} aria-labelledby="record-form-title">
    <h2 id="record-form-title" className="mb-4 font-bold">{t(editing.id ? copy.editTitle : copy.newTitle)}</h2>
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <div className={kind === "meeting" ? "sm:col-span-2" : ""}><label className="label" htmlFor="record-title">{t(copy.name)}<span className="text-danger"> *</span></label><input id="record-title" className="w-full" maxLength={120} required placeholder={t(copy.namePlaceholder)} value={editing.draft.title} onChange={(event) => setField("title", event.target.value)} /></div>
      {kind === "course" && <div><label className="label" htmlFor="record-category">{t("courses.category")}</label><select id="record-category" className="w-full" value={editing.draft.category} onChange={(event) => setField("category", event.target.value)}><option value="">{t("courses.categoryNone")}</option>{COURSE_CATEGORIES.map((code) => <option key={code} value={code}>{t(categoryKey(code))}</option>)}</select></div>}
      <div><label className="label" htmlFor="record-start">{t("records.start")}<span className="text-danger"> *</span></label><input id="record-start" className="w-full" type="datetime-local" required value={editing.draft.starts_at} onChange={(event) => setField("starts_at", event.target.value)} /></div>
      <div><label className="label" htmlFor="record-end">{t("records.end")}</label><input id="record-end" className="w-full" type="datetime-local" min={editing.draft.starts_at || undefined} value={editing.draft.ends_at} onChange={(event) => setField("ends_at", event.target.value)} /></div>
      <div><label className="label" htmlFor="record-location">{t("records.location")}</label><input id="record-location" className="w-full" maxLength={200} placeholder={t("records.locationPlaceholder")} value={editing.draft.location} onChange={(event) => setField("location", event.target.value)} /></div>
      {kind === "meeting"
        ? <div><label className="label" htmlFor="record-project">{t("meetings.project")}</label><select id="record-project" className="w-full" value={editing.draft.project_id} onChange={(event) => setField("project_id", event.target.value)}><option value="">{t("meetings.noProject")}</option>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
        : <div><label className="label" htmlFor="record-organizer">{t("courses.organizer")}</label><input id="record-organizer" className="w-full" maxLength={120} placeholder={t("courses.organizerPlaceholder")} value={editing.draft.organizer} onChange={(event) => setField("organizer", event.target.value)} /></div>}
      <div className="sm:col-span-2"><label className="label" htmlFor="record-attendees">{t(copy.attendees)}</label><input id="record-attendees" className="w-full" maxLength={500} placeholder={t(copy.attendeesPlaceholder)} value={editing.draft.attendees} onChange={(event) => setField("attendees", event.target.value)} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="record-summary">{t(copy.summary)}</label><textarea id="record-summary" className="w-full" rows={6} maxLength={5000} placeholder={t(copy.summaryPlaceholder)} value={editing.draft.summary} onChange={(event) => setField("summary", event.target.value)} /></div>
    </div>
    {error && <div className="mt-4"><ErrorBox message={error} /></div>}
    <div className="mt-4 flex flex-wrap gap-2"><button className="btn" disabled={busy}>{t(busy ? "common.processing" : "common.save")}</button><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</button></div>
  </form>;

  const section = (heading: TransKey, list: MeetingRecord[]) => list.length > 0 && <section className="mb-8">
    <h2 className="mb-3 border-b border-gold-dim pb-2 font-bold text-gold-bright">{t(heading)}<span className="ml-2 text-sm font-normal text-star-dim">{t("common.items", { count: list.length })}</span></h2>
    <ul className="space-y-3">{list.map((record) => <RecordCard key={record.id} record={record} lang={lang} onEdit={() => startEdit(record)} onDelete={() => void remove(record)} />)}</ul>
  </section>;

  return <>
    <PageHeader title={t(copy.title)} description={t(copy.description)} actions={!editing && <button className="btn" onClick={startNew}>{t(copy.add)}</button>} />
    {error && !editing && <ErrorBox message={error} />}
    {message && <div role="status" className="mb-4 rounded-card border border-ok bg-void p-3 text-sm text-ok">{message}</div>}
    {form}
    {filters}
    {!records ? <Loading /> : !records.length ? <Empty>{t(copy.empty)}</Empty> : !shown.length ? <Empty>{t(category ? "records.noMatchFiltered" : ranged && !query.trim() ? "records.noMatchRange" : "records.noMatch")}</Empty> : <>{section("records.upcoming", upcoming)}{section("records.past", past)}</>}
  </>;
}

function RecordCard({ record, lang, onEdit, onDelete }: { record: MeetingRecord; lang: "zh" | "en"; onEdit(): void; onDelete(): void }) {
  const t = useT();
  const copy = COPY[record.kind];
  const long = record.summary.split("\n").length > SUMMARY_PREVIEW_LINES || [...record.summary].length > SUMMARY_PREVIEW_CHARS;
  const [open, setOpen] = useState(false);
  return <li id={record.id} className="panel scroll-mt-24">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><h3 className="text-lg font-bold break-words">{record.title}</h3>{record.kind === "course" && record.category && <span className="badge">{t(categoryKey(record.category))}</span>}</div>
      <span className="text-sm font-semibold text-psi">{formatRecordTime(record.starts_at, record.ends_at, lang)}</span>
    </div>
    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
      {record.location && <><dt className="text-star-dim">{t("records.location")}</dt><dd className="break-words">{record.location}</dd></>}
      {record.kind === "meeting" && record.project_id && <><dt className="text-star-dim">{t("meetings.project")}</dt><dd className="break-words"><Link className="text-psi hover:text-star" to={`/projects/${record.project_id}`}>{record.project_name ?? record.project_id}</Link></dd></>}
      {record.kind === "course" && record.organizer && <><dt className="text-star-dim">{t("courses.organizer")}</dt><dd className="break-words">{record.organizer}</dd></>}
      {record.attendees && <><dt className="text-star-dim">{t(copy.attendees)}</dt><dd className="break-words">{record.attendees}</dd></>}
    </dl>
    {record.summary && <div className="mt-3 border-t border-nexus-line pt-3">
      <p className={`whitespace-pre-wrap break-words text-sm ${long && !open ? "line-clamp-6" : ""}`}>{record.summary}</p>
      {long && <button type="button" className="mt-1 text-xs font-semibold text-psi" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "records.showLess" : "records.showMore")}</button>}
    </div>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-star-dim">
      <span>{t("records.by", { name: record.created_by_name ?? "—" })}</span>
      {record.can_edit && <span className="flex gap-3"><button className="font-semibold text-psi" aria-label={t("records.editNamed", { title: record.title })} onClick={onEdit}>{t("common.edit")}</button><button className="font-semibold text-danger" aria-label={t("records.deleteNamed", { title: record.title })} onClick={onDelete}>{t("common.delete")}</button></span>}
    </div>
  </li>;
}
