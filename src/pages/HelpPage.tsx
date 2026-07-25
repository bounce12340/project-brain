import { PageHeader } from "../components/UI";
import { useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";

const sections: Array<[TransKey, Array<[TransKey, TransKey]>]> = [
  ["help.account", [["help.apply", "help.applyText"], ["help.approval", "help.approvalText"], ["help.switch", "help.switchText"]]],
  ["help.security", [["help.transfer", "help.transferText"], ["help.coAdmin", "help.coAdminText"], ["help.fullTransfer", "help.fullTransferText"]]],
  ["help.dashboard", [["help.kpi", "help.kpiText"], ["help.license", "help.licenseText"], ["help.risk", "help.riskText"]]],
  ["help.projects", [["help.newProject", "help.newProjectText"], ["help.okr", "help.okrText"], ["help.views", "help.viewsText"], ["help.drawer", "help.drawerText"], ["help.schedule", "help.scheduleText"]]],
  ["help.qa", [["help.registry", "help.registryText"], ["help.ccr", "help.ccrText"], ["help.regwatch", "help.regwatchText"], ["help.regAi", "help.regAiText"], ["help.tfdaReview", "help.tfdaReviewText"]]],
  ["help.collaboration", [["help.mention", "help.mentionText"], ["help.files", "help.filesText"], ["help.automation", "help.automationText"]]],
  ["help.personal", [["help.todos", "help.todosText"], ["help.notifications", "help.notificationsText"], ["help.timeline", "help.timelineText"], ["help.reports", "help.reportsText"], ["help.font", "help.fontText"], ["help.languageTheme", "help.languageThemeText"]]],
  ["help.admin", [["help.import", "help.importText"]]],
];

export function HelpPage() {
  const t = useT();
  return <><PageHeader title={t("help.title")} description={t("help.description")} actions={<button className="btn" onClick={() => window.dispatchEvent(new Event("project-brain:start-tour"))}>{t("help.replay")}</button>} /><div className="grid gap-5 md:grid-cols-2">{sections.map(([title, items]) => <section className="panel" key={title}><h2 className="mb-4 text-lg font-bold text-gold-bright">{t(title)}</h2><dl className="space-y-4">{items.map(([name, usage]) => <div key={name}><dt className="font-semibold">{t("help.whatIs", { name: t(name) })}</dt><dd className="mt-1 text-sm leading-6 text-star-dim">{t(usage)}</dd></div>)}</dl></section>)}</div></>;
}
