import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, apiDownload, formatDate } from "../api";
import type { ProjectFile } from "../types";
import { Empty, ErrorBox } from "./UI";
import { useLang, useT } from "../i18n/LangContext";

export function ProjectFiles({ projectId, taskId, canEdit, compact = false, onChanged }: { projectId: string; taskId?: string; canEdit: boolean; compact?: boolean; onChanged?(): void }) {
  const t = useT(); const { lang } = useLang();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = () => api<{ files: ProjectFile[] }>(`/projects/${projectId}/files`).then((data) => setFiles(taskId ? data.files.filter((file) => file.task_id === taskId) : data.files));
  useEffect(() => { void load(); }, [projectId, taskId]);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError("");
    const form = new FormData(); form.append("file", file); if (taskId) form.append("task_id", taskId);
    try { await api(`/projects/${projectId}/files`, { method: "POST", body: form }); await load(); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("files.uploadFailed")); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const drop = (event: DragEvent) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); };
  const download = async (file: ProjectFile) => { const blob = await apiDownload(`/files/${file.id}/download`); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); };
  const remove = async (file: ProjectFile) => { if (!window.confirm(t("files.deleteConfirm", { name: file.filename }))) return; await api(`/files/${file.id}`, { method: "DELETE" }); await load(); onChanged?.(); };
  return <section className={compact ? "" : "panel"}>
    {!compact && <h2 className="mb-4 font-bold">{t("files.title")}</h2>}
    {error && <ErrorBox message={error} />}
    {canEdit && <div className="mb-4 rounded-xl border-2 border-dashed border-nexus-line p-5 text-center text-sm text-star-dim" onDragOver={(e) => e.preventDefault()} onDrop={drop}><p>{t(busy ? "files.uploading" : "files.drop")}</p><input ref={input} className="mt-3 max-w-full" type="file" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} /></div>}
    {files.length ? <div className="divide-y divide-nexus-line">{files.map((file) => <div className="flex flex-wrap items-center gap-3 py-3 text-sm" key={file.id}><div className="min-w-0 flex-1"><p className="truncate font-medium">{file.filename}</p><p className="text-xs text-star-dim">{formatBytes(file.size)} · {file.uploaded_by_name} · {formatDate(file.created_at, true, lang)}{file.task_title ? ` · ${file.task_title}` : ""}</p></div><button className="btn-secondary !px-3 !py-1.5" onClick={() => void download(file)}>{t("common.download")}</button>{file.can_delete && <button className="text-xs text-danger" onClick={() => void remove(file)}>{t("common.delete")}</button>}</div>)}</div> : <Empty>{t("files.empty")}</Empty>}
  </section>;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
