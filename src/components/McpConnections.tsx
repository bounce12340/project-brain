import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import { useLang, useT } from "../i18n/LangContext";
import { ErrorBox } from "./UI";

interface Connection { id: string; client_name: string; can_write: boolean; connected_at: string | null; expires_at: string | null }

/** 個人設定的「AI 連接器」：連接器網址、怎麼接、已連接的 AI 工具與中斷連線。 */
export function McpConnections() {
  const t = useT(); const { lang } = useLang();
  const [endpoint, setEndpoint] = useState("");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const load = () => api<{ endpoint: string; connections: Connection[] }>("/mcp/connections")
    .then((data) => { setEndpoint(data.endpoint); setConnections(data.connections); })
    .catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setConnections([]); });
  useEffect(() => { void load(); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(endpoint); setCopied(true); window.setTimeout(() => setCopied(false), 2_000); } catch { setCopied(false); } };
  const disconnect = async (connection: Connection) => {
    if (!window.confirm(t("mcp.disconnectConfirm", { name: connection.client_name }))) return;
    try { await api(`/mcp/connections/${encodeURIComponent(connection.id)}`, { method: "DELETE" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="panel mt-6" aria-labelledby="mcp-title">
    <h2 id="mcp-title" className="font-bold">{t("mcp.title")}</h2>
    <p className="mt-1 text-sm leading-6 text-star-dim">{t("mcp.description")}</p>
    {error && <div className="mt-3"><ErrorBox message={error} /></div>}
    <label className="label mt-4" htmlFor="mcp-endpoint">{t("mcp.endpoint")}</label>
    <div className="flex flex-wrap gap-2">
      <input id="mcp-endpoint" className="min-w-0 flex-1 font-mono text-sm" readOnly value={endpoint} onFocus={(event) => event.currentTarget.select()} />
      <button type="button" className="btn-secondary" onClick={() => void copy()} disabled={!endpoint}>{t(copied ? "mcp.copied" : "mcp.copy")}</button>
    </div>
    <h3 className="mt-5 text-sm font-semibold">{t("mcp.howTitle")}</h3>
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6">
      <li>{t("mcp.step1")}</li><li>{t("mcp.step2")}</li><li>{t("mcp.step3")}</li>
    </ol>
    <p className="mt-2 text-xs leading-5 text-star-dim">{t("mcp.otherTools")} <code className="break-all">claude mcp add --transport http project-brain {endpoint}</code></p>
    <p className="mt-2 text-xs leading-5 text-star-dim">{t("mcp.examples")}</p>
    <h3 className="mt-5 text-sm font-semibold">{t("mcp.connected")}</h3>
    {!connections ? <p className="mt-2 text-sm text-star-dim">{t("common.loading")}</p> : connections.length ? <ul className="mt-2 divide-y divide-nexus-line border-y border-nexus-line">
      {connections.map((connection) => <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <div className="min-w-0">
          <p className="font-medium break-words">{connection.client_name}</p>
          <p className="text-xs text-star-dim">{t(connection.can_write ? "mcp.canWrite" : "mcp.readOnly")}{connection.connected_at ? ` · ${t("mcp.connectedAt", { date: formatDate(connection.connected_at, true, lang) })}` : ""}</p>
        </div>
        <button type="button" className="btn-danger !py-1.5" onClick={() => void disconnect(connection)}>{t("mcp.disconnect")}</button>
      </li>)}
    </ul> : <p className="mt-2 text-sm text-star-dim">{t("mcp.none")}</p>}
  </section>;
}
