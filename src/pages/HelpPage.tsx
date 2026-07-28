import { startTour } from "../components/OnboardingTour";
import { PageHeader } from "../components/UI";
import { CONCEPT_DEFINITIONS } from "../help-topics";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";

interface QuickstartScenario {
  id: "quickstart-a" | "quickstart-b" | "quickstart-c";
  title: string;
  outcome: string;
  steps: readonly string[];
}

export const HELP_MANUAL = {
  zh: {
    title: "艾爾水晶完整使用手冊",
    description: "先照情境完成一輪，再用概念表與功能索引查細節。",
    projectTour: "播放「專案系統入門」",
    regulatoryTour: "播放「法規系統入門」",
    quickstart: "快速上手",
    quickstartIntro: "以下範例都用示範資料；照著輸入即可理解完整流程。",
    concepts: "這四個東西差在哪",
    conceptsIntro: "實際上常被混淆的是五種項目；請先看它是否代表工作、節點、事實、敘事或私人提醒。",
    featureIndex: "功能索引",
    featureIntro: "保留既有逐功能說明，並補上本版提示、導覽與法規流程。",
    columns: ["概念", "語意", "有無日期", "影響進度", "典型例子（RA 註冊案）"],
    step: "步驟",
    scenarios: [
      {
        id: "quickstart-a",
        title: "情境 A：建立查驗登記專案並排出時程",
        outcome: "結果：得到可執行、會依依賴接龍的 RA 送件時程。",
        steps: [
          "到「專案」按新增，名稱填「ABC 藥品查驗登記」。",
          "組別選 RA、可見性選組內，目標日填「2027-03-31」。",
          "階段模板選「待辦 → 進行中 → 完成」，建立專案。",
          "新增任務「收到 CTD 文件」，日期設 2026-08-14。",
          "新增「CTD 文件審查」，並把前置依賴勾為「收到 CTD 文件」。",
          "確認審查任務起始日接到 2026-08-15，再填到期日 2026-08-28。",
          "新增里程碑「完成 CTD 缺件確認」，到期日填 2026-08-28。",
        ],
      },
      {
        id: "quickstart-b",
        title: "情境 B：每週回報進度",
        outcome: "結果：一篇可追溯的週進度，並把文字中的動作同步回專案。",
        steps: [
          "進入專案的「進度紀錄」，零散筆記填「CTD 已收齊，週五審完」。",
          "按「AI 快寫」，檢查稿件是否忠於原意，再補上下週送件計畫。",
          "發布後打開 AI 連動建議，不要直接全選。",
          "勾選「完成收到 CTD 文件」與「新增完成收件歷程事件」。",
          "逐項確認日期與任務名稱後套用，回總覽檢查里程碑與進度。",
          "到儀表板確認近期動態，再到報表產生本週 RA 組週報。",
        ],
      },
      {
        id: "quickstart-c",
        title: "情境 C：處理一則 TFDA 公告",
        outcome: "結果：公告經人工核對後發布，之後可用年月與產品線找回。",
        steps: [
          "到「法規動態」切換待審核，開啟一則 TFDA 草稿。",
          "核對公告日期是發布日；若內文另有施行日，寫入重點。",
          "確認產品線，例如 UDI 公告選「醫療器材」。",
          "閱讀附件原文，核對標題、重點與來源連結，不只看 AI 摘要。",
          "正確就核准；有誤先編輯。非本公司範圍則駁回或刪除。",
          "回已發布清單，選年份、月份與產品線確認能找到該公告。",
        ],
      },
    ] satisfies readonly QuickstartScenario[],
  },
  en: {
    title: "Complete Aiur Crystal Manual",
    description: "Run one scenario first, then use the concept table and feature index for details.",
    projectTour: "Play Project System Tour",
    regulatoryTour: "Play Regulatory System Tour",
    quickstart: "Quick start",
    quickstartIntro: "These examples use demo data. Enter the shown values to learn the full workflow.",
    concepts: "How these concepts differ",
    conceptsIntro: "Five items are commonly confused. First decide whether it represents work, a checkpoint, a fact, a narrative, or a private reminder.",
    featureIndex: "Feature index",
    featureIntro: "The existing feature guide is preserved and expanded with help tips, tours, and regulatory workflows.",
    columns: ["Concept", "Meaning", "Dates", "Progress impact", "Typical RA registration example"],
    step: "Step",
    scenarios: [
      {
        id: "quickstart-a",
        title: "Scenario A: Build a registration project and schedule",
        outcome: "Result: an actionable RA submission schedule with dependency-driven dates.",
        steps: [
          "Open Projects and create “ABC Drug Registration.”",
          "Choose the RA group, Group visibility, and target date 2027-03-31.",
          "Choose the To do → In progress → Done stage template and create it.",
          "Add “Receive CTD dossier” with due date 2026-08-14.",
          "Add “Review CTD dossier” and select Receive CTD dossier as its dependency.",
          "Confirm the review starts 2026-08-15, then set its due date to 2026-08-28.",
          "Add milestone “Complete CTD gap review” due 2026-08-28.",
        ],
      },
      {
        id: "quickstart-b",
        title: "Scenario B: Report weekly progress",
        outcome: "Result: a traceable weekly update with selected actions synchronized to the project.",
        steps: [
          "Open Progress Updates and enter “CTD complete; finish review Friday” as rough notes.",
          "Select AI Draft, verify it stays factual, and add next week's submission plan.",
          "Publish, then open linked AI suggestions; do not select everything blindly.",
          "Select Complete Receive CTD dossier and Add dossier-received history event.",
          "Verify each task name and date before applying, then review Overview.",
          "Check Recent activity on Dashboard and generate this week's RA report.",
        ],
      },
      {
        id: "quickstart-c",
        title: "Scenario C: Process one TFDA announcement",
        outcome: "Result: a human-verified publication that can be retrieved by month and product line.",
        steps: [
          "Open Regulatory Watch, switch to Pending, and open one TFDA draft.",
          "Confirm the announcement date is publication; put a separate effective date in Key points.",
          "Verify the product line; for example, classify a UDI notice as Medical devices.",
          "Read the source attachment and verify title, key points, and source link.",
          "Approve if correct, edit errors first, or reject an out-of-scope item.",
          "Return to Published and retrieve it by year, month, and product line.",
        ],
      },
    ] satisfies readonly QuickstartScenario[],
  },
} as const;

const sections: Array<{ id: string; title: TransKey; items: Array<[TransKey, TransKey]> }> = [
  { id: "feature-account", title: "help.account", items: [["help.apply", "help.applyText"], ["help.approval", "help.approvalText"], ["help.switch", "help.switchText"]] },
  { id: "feature-security", title: "help.security", items: [["help.transfer", "help.transferText"], ["help.coAdmin", "help.coAdminText"], ["help.fullTransfer", "help.fullTransferText"]] },
  { id: "feature-dashboard", title: "help.dashboard", items: [["help.kpi", "help.kpiText"], ["help.license", "help.licenseText"], ["help.risk", "help.riskText"]] },
  { id: "feature-projects", title: "help.projects", items: [["help.newProject", "help.newProjectText"], ["help.okr", "help.okrText"], ["help.views", "help.viewsText"], ["help.drawer", "help.drawerText"], ["help.progressEditing", "help.progressEditingText"], ["help.progressLinks", "help.progressLinksText"], ["help.schedule", "help.scheduleText"]] },
  { id: "feature-specialist", title: "help.qa", items: [["help.registry", "help.registryText"], ["help.ccr", "help.ccrText"], ["help.regwatch", "help.regwatchText"], ["help.regwatchFilters", "help.regwatchFiltersText"], ["help.regAi", "help.regAiText"], ["help.tfdaReview", "help.tfdaReviewText"]] },
  { id: "feature-collaboration", title: "help.collaboration", items: [["help.mention", "help.mentionText"], ["help.files", "help.filesText"], ["help.automation", "help.automationText"]] },
  { id: "feature-personal", title: "help.personal", items: [["help.todos", "help.todosText"], ["help.notifications", "help.notificationsText"], ["help.timeline", "help.timelineText"], ["help.reports", "help.reportsText"], ["help.font", "help.fontText"], ["help.languageTheme", "help.languageThemeText"]] },
  { id: "feature-admin", title: "help.admin", items: [["help.import", "help.importText"]] },
];

const featureAnchors: Partial<Record<TransKey, string>> = {
  "help.views": "feature-views",
  "help.okr": "feature-okr",
  "help.regwatch": "feature-regwatch",
  "help.reports": "feature-reports",
  "help.timeline": "feature-timeline",
};

export function HelpPage() {
  const t = useT();
  const { lang } = useLang();
  const content = HELP_MANUAL[lang];
  const concepts = CONCEPT_DEFINITIONS[lang];

  return <>
    <PageHeader
      title={content.title}
      description={content.description}
      actions={<div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => startTour("project")}>{content.projectTour}</button>
        <button className="btn-secondary" onClick={() => startTour("regulatory")}>{content.regulatoryTour}</button>
      </div>}
    />

    <nav className="panel mb-6 flex flex-wrap gap-4 text-sm" aria-label={lang === "zh" ? "手冊章節" : "Manual sections"}>
      <a className="text-psi underline" href="#quickstart">{content.quickstart}</a>
      <a className="text-psi underline" href="#concepts">{content.concepts}</a>
      <a className="text-psi underline" href="#feature-index">{content.featureIndex}</a>
    </nav>

    <section className="scroll-mt-28" id="quickstart">
      <h2 className="text-2xl font-bold text-gold-bright">{content.quickstart}</h2>
      <p className="mt-2 text-sm text-star-dim">{content.quickstartIntro}</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">{content.scenarios.map((scenario) => <article className="panel scroll-mt-28" id={scenario.id} key={scenario.id}>
        <h3 className="text-lg font-bold">{scenario.title}</h3>
        <ol className="mt-4 space-y-3">{scenario.steps.map((step, index) => <li className="flex gap-3 text-sm leading-6" key={step}>
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-psi text-xs font-bold text-psi" aria-label={`${content.step} ${index + 1}`}>{index + 1}</span>
          <span>{step}</span>
        </li>)}</ol>
        <p className="mt-5 border-t border-nexus-line pt-3 text-sm font-semibold text-ok">{scenario.outcome}</p>
      </article>)}</div>
    </section>

    <section className="mt-10 scroll-mt-28" id="concepts">
      <h2 className="text-2xl font-bold text-gold-bright">{content.concepts}</h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-star-dim">{content.conceptsIntro}</p>
      <div className="panel mt-5 overflow-x-auto">
        <table className="min-w-[860px] w-full text-left text-sm">
          <thead><tr className="border-b border-nexus-line">{content.columns.map((column) => <th className="px-3 py-3" key={column}>{column}</th>)}</tr></thead>
          <tbody>{concepts.map((item) => <tr className="border-b border-nexus-line" key={item.key}>
            <td className="px-3 py-4 font-bold text-gold-bright">{item.label}</td>
            <td className="px-3 py-4">{item.meaning}</td>
            <td className="px-3 py-4">{item.dates}</td>
            <td className="px-3 py-4">{item.progress}</td>
            <td className="px-3 py-4 text-star-dim">「{item.example}」</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="mt-10 scroll-mt-28" id="feature-index">
      <h2 className="text-2xl font-bold text-gold-bright">{content.featureIndex}</h2>
      <p className="mt-2 text-sm text-star-dim">{content.featureIntro}</p>
      <div className="mt-5 grid gap-5 md:grid-cols-2">{sections.map((section) => <section className="panel scroll-mt-28" id={section.id} key={section.id}>
        <h3 className="mb-4 text-lg font-bold text-gold-bright">{t(section.title)}</h3>
        <dl className="space-y-4">{section.items.map(([name, usage]) => <div className="scroll-mt-28" id={featureAnchors[name]} key={name}>
          <dt className="font-semibold">{t("help.whatIs", { name: t(name) })}</dt>
          <dd className="mt-1 text-sm leading-6 text-star-dim">{t(usage)}</dd>
        </div>)}</dl>
      </section>)}</div>
    </section>
  </>;
}
