import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useLang, useT } from "../i18n/LangContext";
import { formatRecordTime, type MeetingRecord } from "../meeting-records";

/** 首頁的「近期會議與上課」：接下來的與剛結束的各幾筆，點了到會議記錄或上課紀錄那一筆。 */
export function DashboardMeetings() {
  const t = useT(); const { lang } = useLang();
  const [data, setData] = useState<{ upcoming: MeetingRecord[]; recent: MeetingRecord[] } | null>(null);
  useEffect(() => { api<{ upcoming: MeetingRecord[]; recent: MeetingRecord[] }>("/meetings/overview").then(setData).catch(() => setData({ upcoming: [], recent: [] })); }, []);
  if (!data) return null;
  const item = (record: MeetingRecord) => <li key={record.id}><Link to={`/${record.kind === "meeting" ? "meetings" : "courses"}#${record.id}`} className="block border-l-2 border-gold-dim pl-3 hover:border-psi">
    <span className="mr-2 text-xs font-semibold text-gold-bright">{t(record.kind === "meeting" ? "records.kindMeeting" : "records.kindCourse")}</span>
    <span className="font-medium text-star">{record.title}</span>
    <span className="block text-xs text-star-dim">{formatRecordTime(record.starts_at, record.ends_at, lang)}{record.location && ` · ${record.location}`}{record.project_name && ` · ${record.project_name}`}</span>
  </Link></li>;
  const empty = !data.upcoming.length && !data.recent.length;
  return <section className="panel">
    <h2 className="mb-4 font-bold">{t("dashboard.meetings")}</h2>
    {empty ? <p className="text-sm text-star-dim">{t("dashboard.meetingsEmpty")}</p> : <div className="space-y-4">
      {data.upcoming.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-psi">{t("dashboard.meetingsUpcoming")}</h3><ul className="space-y-3">{data.upcoming.map(item)}</ul></div>}
      {data.recent.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-star-dim">{t("dashboard.meetingsRecent")}</h3><ul className="space-y-3">{data.recent.map(item)}</ul></div>}
    </div>}
    <p className="mt-4 flex gap-4 text-sm"><Link className="font-semibold text-psi hover:text-star" to="/meetings">{t("dashboard.meetingsAll")} →</Link><Link className="font-semibold text-psi hover:text-star" to="/courses">{t("dashboard.coursesAll")} →</Link></p>
  </section>;
}
