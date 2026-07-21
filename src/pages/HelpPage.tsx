import { PageHeader } from "../components/UI";

const sections = [
  ["儀表板", [["KPI 卡", "看全體概況；點專案列進入詳細頁。"], ["風險 badge", "綠黃紅表示 AI 分析風險；到專案總覽可重跑。"]]],
  ["專案與任務", [["新增專案", "1. 選組別與可見性。2. 選模板。3. 建立。"], ["看板／清單／日曆／甘特", "1. 進專案任務籤。2. 切換視圖。3. 點任務開抽屜。"], ["任務抽屜", "編輯日期與負責人、完成、依賴、留言、附件與 AI 摘要。"], ["AI 排程建議", "1. 產生建議。2. 預覽日期。3. 套用全部。"]]],
  ["協作", [["@提及", "1. 留言輸入 @。2. 選姓名。3. 送出後對方收到通知。"], ["檔案", "拖放或選檔上傳；可在專案或任務層級下載與刪除。"], ["自動化", "1. 選觸發條件。2. 選動作。3. 建立後可停用。"]]],
  ["個人工作", [["待辦", "可關聯專案；自動模式下完成會推進專案進度。"], ["通知", "鈴鐺顯示未讀數；點通知可直達專案或任務。"], ["時間軸", "比較所有可見進行中專案的起訖、進度與風險。"]]],
] as const;

export function HelpPage() {
  return <><PageHeader title="艾爾水晶功能說明" description="如同卡拉，快速理解每個入口與操作流程。" actions={<button className="btn" onClick={() => window.dispatchEvent(new Event("project-brain:start-tour"))}>重新播放導覽</button>} /><div className="grid gap-5 md:grid-cols-2">{sections.map(([title, items]) => <section className="card" key={title}><h2 className="mb-4 text-lg font-bold text-brand-800">{title}</h2><dl className="space-y-4">{items.map(([name, usage]) => <div key={name}><dt className="font-semibold">{name}是什麼</dt><dd className="mt-1 text-sm leading-6 text-slate-600">{usage}</dd></div>)}</dl></section>)}</div></>;
}

