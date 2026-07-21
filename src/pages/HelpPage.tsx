import { PageHeader } from "../components/UI";

const sections = [
  ["帳號申請與核准", [["申請帳號", "1. 登入頁點申請帳號。2. 收 Email 驗證碼。3. 送出待核。"], ["註冊核准", "管理員在管理中心調整角色與組別，再核准或拒絕申請。"], ["註冊開關", "管理員可暫停自助註冊；關閉時不接受驗證碼與申請。"]]],
  ["管理權與帳號安全", [["管理權移轉", "1. 選接班人與模式。2. 輸入目前密碼。3. 確認移轉。"], ["共同管理員", "接班人升為管理員，原管理員仍保有管理權，適合備援。"], ["完全移轉", "接班人先升任，再將自己降為成員；系統不允許移除最後一名管理員。"]]],
  ["儀表板", [["KPI 卡", "看全體概況與本季 KR 完成數；點專案列進入詳細頁。"], ["證照效期警示", "QA 組成員與管理員可看到 90 天內到期的證照。"], ["風險 badge", "綠黃紅表示 AI 分析風險；到專案總覽可重跑。"]]],
  ["專案與任務", [["新增專案", "1. 選組別與可見性。2. 選模板。3. 建立。"], ["OKR", "專案總覽可切換季度、設定 objective、建立與拖拉 KR；auto 進度會納入 KR。"], ["看板／清單／日曆／甘特", "1. 進專案任務籤。2. 切換視圖。3. 點任務開抽屜。"], ["任務抽屜", "編輯日期與負責人、完成、依賴、留言、附件與 AI 摘要。"], ["AI 排程建議", "1. 產生建議。2. 預覽日期。3. 套用全部。"]]],
  ["QA 與法規", [["效期登記簿", "QA 專案的 QA 分頁可新增證照與系統效期，並依剩餘天數顯示警示。"], ["CCR", "建立變更管制後依合法狀態逐步流轉；每一步保留歷程，效期確認會建立待辦。"], ["法規動態", "全員可在導覽列查閱並篩選；RA/PV 正職成員與管理員可新增、編輯、刪除。"]]],
  ["協作", [["@提及", "1. 留言輸入 @。2. 選姓名。3. 送出後對方收到通知。"], ["檔案", "拖放或選檔上傳；可在專案或任務層級下載與刪除。"], ["自動化", "1. 選觸發條件。2. 選動作。3. 建立後可停用。"]]],
  ["個人工作", [["待辦", "可關聯專案；自動模式下完成會推進專案進度。"], ["通知", "鈴鐺顯示未讀數；點通知可直達專案或任務。"], ["時間軸", "比較所有可見進行中專案的起訖、進度與風險。"]]],
  ["管理功能", [["批次匯入", "管理員貼上 JSON 後先在瀏覽器預覽筆數，再確認執行並查看 created／updated／skipped 報告。格式見 IMPORT.md。"]]],
] as const;

export function HelpPage() {
  return <><PageHeader title="艾爾水晶功能說明" description="如同卡拉，快速理解每個入口與操作流程。" actions={<button className="btn" onClick={() => window.dispatchEvent(new Event("project-brain:start-tour"))}>重新播放導覽</button>} /><div className="grid gap-5 md:grid-cols-2">{sections.map(([title, items]) => <section className="panel" key={title}><h2 className="mb-4 text-lg font-bold text-gold-bright">{title}</h2><dl className="space-y-4">{items.map(([name, usage]) => <div key={name}><dt className="font-semibold">{name}是什麼</dt><dd className="mt-1 text-sm leading-6 text-star-dim">{usage}</dd></div>)}</dl></section>)}</div></>;
}
