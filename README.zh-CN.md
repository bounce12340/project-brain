# 🔷 艾爾水晶（艾尔水晶）- 项目进度

[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文** | [日本語](README.ja.md) | [한국어](README.ko.md)

> 如同卡拉，让团队在水晶中共同感知每个项目的脉动。

**正式站点**：<https://projects.uic-ai.com>｜**版本**：v11.2｜**测试**：206/206 ✅｜**平台**：Cloudflare Workers

面向台湾医药代理商（UIC）内部团队的共享项目进度平台。它取代了原先分散在六份 Excel 中的跟踪方式（BD／RA／QA／临床各自为政、同一项目被多人重复记录），把项目、进度、OKR、法规动态、证照有效期、变更控制汇集到同一颗水晶中：全员实时共感、分级权限、AI 辅助、自动提醒。

## ✨ 功能概览

- **项目管理**：分组（BD／临床／QA／RA-PV）、三级可见性（全公司／同组／保密）、同组成员可互相协助填写、实习生视野受限、自动／手动进度、里程碑、阶段模板
- **任务四视图**：看板（拖放）｜列表｜日历｜甘特图（依赖箭头＋today 线）；任务抽屉包含留言 `@提及`、附件、依赖和 AI 摘要
- **OKR**：季度目标＋Key Results（负责人／状态／排序），完成度计入自动进度
- **专属模块**：临床收案（目标 vs 累计、逐日登记）｜BD 查验登记（案件状态机、历程、费用）｜QA 证照有效期（到期分级警示＋自动通知）和 CCR 变更控制（`CCR-YYYY-NNN` 状态机＋历程）
- **法规动态**：收录 2018 年以来 600+ 条 TFDA 法规的知识库，按公告日期排序，并支持按产品线／类别／关键词筛选；每日自动抓取 TFDA RSS 生成待审草稿，批准后才向全员发布；也可粘贴公告文字或合并上传多个文件，通过 AI 结构化导入
- **AI 智能**（Ollama Cloud，deepseek-v4-pro）：进度快写、任务摘要、项目风险预测、排期建议、周报／月报自动生成
- **自动化**：规则引擎“当…就…”；三条 cron 分别执行每日 TFDA RSS 抓取＋提醒、AI 周报（周一）和 AI 月报（每月 1 日）
- **报表**：一键生成分组周报／月报并打印、CSV 导出、按分组泳道展示的时间轴
- **账号**：自助注册＋Email 验证码＋管理员批准；管理权转移（共同管理员／完全转移）＋最后一名管理员保护
- **界面**：星际争霸神族主题（金＝结构、蓝＝能量、切角面板、护盾进度条）、深色／浅色切换、繁中／English 切换、首次登录引导和字号切换

## 🏗 系统架构

```mermaid
flowchart LR
  U[浏览器 SPA<br/>React + Protoss 主题] -->|HTTPS<br/>projects.uic-ai.com| W[Cloudflare Worker<br/>Hono API + 静态资源]
  W --> D1[(D1 数据库<br/>27 张表)]
  W --> R2[(R2 文件<br/>附件/公告原始文件)]
  W -->|OpenAI 兼容| LLM[Ollama Cloud<br/>deepseek-v4-pro]
  W -.->|无 key fallback| WAI[Workers AI<br/>Llama 3.3]
  CRON[Cron ×3<br/>每日/每周/每月] --> W
  W -->|提醒·报告·邀请| MAIL[AgentMail<br/>uic_ai@agentmail.to]
```

## 🧰 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 · Vite · TypeScript · Tailwind CSS · @dnd-kit（拖放）· Recharts（图表）· 自研日历／甘特图 SVG |
| 后端 | Cloudflare Workers · Hono · Workers Static Assets |
| 数据 | D1（SQLite，raw SQL migrations）· R2（文件）· unpdf（PDF 文本层提取） |
| AI | OpenAI 兼容层（Ollama Cloud `deepseek-v4-pro`）＋ Workers AI fallback |
| 邮件 | AgentMail REST API |
| 认证 | PBKDF2-SHA256（WebCrypto）· httpOnly session cookie · Email OTP |
| 测试 | Vitest 160 tests（权限矩阵、状态机、i18n key parity、theme 对比度、算法、导入幂等） |

## 📁 项目结构

```
worker/            # Hono API：routes、middleware、services（permissions/llm/mailer/crypto…）
src/               # React SPA：pages、components、Protoss design tokens
migrations/        # D1 migrations 0001–0007
tests/             # Vitest（＋fixtures）
scripts/           # 各版正式站 E2E 驗收腳本
SPEC*.md           # 各版規格書（開發都由規格驅動）
ACCEPTANCE*.md     # 各版驗收證據（指令與結果原文）
IMPORT.md          # 批次匯入 JSON 合約
BACKUP.md          # 備份與還原手冊
backup.ps1         # 每週自動備份（D1 dump + R2 → OneDrive）
DECISIONS.md       # 實作決策紀錄
```

## 🚀 本地开发

```powershell
npm install
npx wrangler types
npx wrangler d1 migrations apply project-brain-db --local
npm run dev
```

本地 Worker 集成测试：

```powershell
npm run build
npx wrangler dev --local
```

质量检查：

```powershell
npm run typecheck
npm test
npm run build
```

`.dev.vars` 仅存放 `LLM_API_KEY` 和 `AGENTMAIL_API_KEY`，并已被 Git 忽略。不得将其值写入 `wrangler.jsonc`、README、日志或 commit。

## ☁️ 部署

```powershell
npx wrangler d1 migrations apply project-brain-db --remote
npx wrangler deploy
```

Secrets 必须从 `.dev.vars` 读取并通过 stdin 传给 Wrangler，不得放在命令参数或输出中。部署后可使用 `npx wrangler secret list` 确认只显示名称。

**更换 LLM 模型**：修改 `wrangler.jsonc` 中的 `vars.LLM_MODEL`（更换端点时还需修改 `vars.LLM_BASE_URL`）→ `typecheck`＋`build`＋`deploy`。系统优先调用 OpenAI 兼容端点；`LLM_API_KEY` 不存在时 fallback 到 Workers AI。

**补绑自定义域名**：目前已绑定 `projects.uic-ai.com`。如果将来重建 Worker 后 custom domain 失效，先移除 `routes` 并部署到 workers.dev，再前往 Dashboard → Workers → project-brain → Settings → Domains & Routes 手动添加，最后恢复 `APP_BASE_URL` 并重新部署。

## ⏰ 排期（UTC cron ↔ 台北时间）

| Cron | 台北时间 | 工作 |
|---|---|---|
| `0 1 * * *` | 每日 09:00 | 先抓取 TFDA RSS 生成待审草稿，再执行里程碑／待办／BD 停滞／QA 证照有效期／项目停滞／自动归档提醒及 Email 汇总；抓取失败不影响提醒 |
| `30 0 * * 1` | 每周一 08:30 | 上周全公司及各组 AI 周报 |
| `30 0 1 * *` | 每月 1 日 08:30 | 上月全公司及各组 AI 月报 |

LLM 失败时仍会保存纯数据版报告；预生成报告一律排除保密项目，并在文末注明。AgentMail 未配置时仅跳过 Email，站内通知不受影响。

## 🔐 账号与权限

### 注册与批准

员工在登录页选择“申请账号”：姓名＋公司 Email＋密码＋分组 → 6 位 Email 验证码（15 分钟）→ 进入待批准状态。管理员在“管理 → 注册申请”中批准（可调整角色／分组）或拒绝，并通过邮件通知结果；批准前无法登录。防滥用措施：同一 Email 发送验证码后冷却 60 秒、验证码最多尝试 5 次、同一 IP 设置每日上限。管理员也可直接创建账号（首次登录强制修改密码）。

### 管理权转移

“管理 → 管理权转移”：**共同管理员**（将对方提升为 admin，自己保持不变）或**完全转移**（以原子操作先升后降）。两种方式都必须重新输入自己的密码；系统在 API 层阻止降级／停用最后一名 active admin。

### 权限速查

| 操作 | admin | owner | 同组 member | project member | intern |
|---|---|---|---|---|---|
| 查看 `all` | 全部 | ✔ | ✔ | ✔ | 仅限已加入的项目 |
| 查看 `group` | 全部 | ✔ | ✔ | ✔ | 仅限已加入的项目 |
| 查看 `private` | 全部 | ✔ | ✘ | ✔ | 仅限已加入的项目 |
| 填写进度／任务／看板／收案／BD 事件 | 全部 | ✔ | ✔ | ✔ | 仅限已加入的项目 |
| 修改可见性／成员／归档／删除 | 全部 | ✔ | ✘ | ✘ | ✘ |
| 查看和填写 BD 费用 | 全部 | ✔ | 同组正式员工 | 跨组不可用 | ✘ |
| 法规 published 列表 | 全部 | ✔ | ✔ | ✔ | ✔ |
| 查看／批准 TFDA 草稿 | 全部 | — | 仅 RA/PV 正式员工 | ✘ | ✘ |

后端 API 逐项复核权限（集中在 `worker/services/permissions.ts`，包含 27 组矩阵测试）；前端隐藏按钮并非唯一防线。intern 的列表、仪表盘、时间轴和报表只汇总其可见项目。

### 演示账号（用于验证权限，密码为 `Brain-2026!`；正式上线后通过“管理 → 清除演示数据”移除）

| 角色 | Email | 姓名 |
|---|---|---|
| 临床组 member | `clinical1@demo.local` | 林曉臨 |
| 临床组 member | `clinical2@demo.local` | 陳收案 |
| BD 组 member | `bd1@demo.local` | 王必達 |
| 临床组 intern | `intern1@demo.local` | 李實習 |

## 📖 日常操作指南

### 语言与主题（English / Dark‧Light）

**如何切换**：导航栏右上方有两个相邻按钮——

1. “**中／EN**”：整个界面在繁体中文和 English 之间切换（导航、按钮、表单、帮助页、新手引导、相对时间全部翻译）。
2. “**☀／🌙**”：实时切换深色（神族深空，默认）和浅色（白昼神殿——暖象牙色背景、金色结构、深 psi 蓝）主题；图表、甘特图、时间轴、风险 badge、护盾进度条同步换色，切换时无闪烁。

**记忆方式**：偏好设置保存在各自浏览器的 localStorage（`AIUR_LANG`／`AIUR_THEME`）中，每位同事互不影响；更换设备或清除缓存后会恢复默认的“繁中＋深色”。

**翻译范围与边界**：

- 跟随语言：界面文字、`/help` 全文、首次引导、个人实时 AI 输出（进度快写、任务摘要、风险预测、排期理由）。
- 固定繁中：用户输入的数据（项目名、进度、留言、法规条目）、Email 通知、组织周报／月报、法规 AI 导入解析结果。
- 打印一律使用白色背景，不受主题影响。

### 项目、任务与自动进度

1. 在“项目 → 新建项目”中设置分组、可见性、目标日期和阶段模板。
2. 在“概览”中可切换手动／自动进度；自动模式＝任务＋里程碑＋关联待办＋KR 的完成比例（新项目默认使用自动模式）。
3. 在“任务”中自由切换四种视图；看板支持拖放阶段和卡片；点击任务打开抽屉，可编辑内容、负责人、起止日期和依赖，并使用留言 `@提及`、附件和 AI 摘要。
4. 在“进度记录”中粘贴随手笔记，再用“AI 快写”整理为三段式草稿，确认后发布。

### 文件、自动化与 AI

- 文件存储在 R2（单个文件 25 MB），下载须通过权限检查；上传者／owner／admin 可以删除。
- “自动化”规则：任务完成／移入阶段／里程碑完成／进度跨过阈值 → 通知／改派／创建待办／写入记录。
- 项目概览中的“AI 风险预测”会保存等级＋建议，并显示在仪表盘中；“AI 排期建议”只有通过后端验证（日期在项目范围内、不违反依赖）后才能应用。

### 法规动态 AI 导入

粘贴公告文字，或合并上传最多 5 个 `.txt`／带文本层的 `.pdf`（单个文件 10 MB、总计 25 MB）。**单条公告**（默认）：整包内容 → 1 条；**多条汇总**：仅在公告日期不同或公告标题不同时拆分。

`entry_date` 一律取公告／发文日期，不取施行／生效日期；施行日会放在摘要后的第一条要点中。如果 AI 提取的日期超过今天 90 天，预览会用警示色提醒，但不阻止编辑或导入。包含“对照表／修正条文／现行条文”的数据会另列“修正重点（前后对照）”，并给出最多 10 条“旧规定→新规定”摘要。

预览中每个单元格均可编辑／排除，确认时按 `(entry_date, title)` 判重；所有原始文件均存入 R2，列表显示 `📎×N`，并支持逐个下载。删除最后一条引用时，会同步移除 D1 关联和 R2 孤立对象。扫描 PDF 如果没有文本层，请改为粘贴文字（特意不提供 OCR）。

### TFDA RSS 自动抓取与审核

每日 09:00 的前置任务读取 TFDA 公告 RSS；RA/PV 正式员工和 admin 也可在法规动态中点击“立即抓取 TFDA”。系统通过已有 TFDA news id、驳回墓碑和 `(公告日期, 标题)` 三重去重，将公告全文（包括表格行）交给现有单条 AI 流程整理；AI 暂时失败时，仍会以“其他”和原文前 500 字创建草稿，确保不会漏掉公告。

新数据一律为 `TFDA 草稿`，系统在站内通知审核人员，并将其纳入每日 Email digest。具备管理权限的人员点击“待审核 N”后，可展开完整要点、编辑（仍保持草稿状态）、逐条批准／删除、勾选多条批量批准／删除，或确认后全部批准；其他 member 和所有 intern 在批准前完全不可见。批准后才会进入普通 published 列表。删除 TFDA 草稿或已发布条目时，会先保留 source ref 墓碑，防止后续 cron 重新创建同一公告；手动条目不受影响。操作和验收时不得代替业务人员批准或删除真实 TFDA 草稿。

### 报表与时间轴

- “报表 → 生成报告”：选择分组＋（本周／上周／本月／上月）即可一键生成，支持打印；member 仅限本组，admin 可选择全公司或包含保密项目的版本。
- “时间轴”：用分组泳道概览所有可见项目，展开行可查看任务时间条（负责人 tooltip）。

### 分组与阶段模板（管理员）

“管理 → 分组”中的类型（`clinical`／`bd`／`qa`／`general`）决定专属模块；被引用的分组不可删除。“阶段模板”使用 `→` 分隔阶段，应用时会复制模板，后续修改模板不会影响现有项目。

## 💾 备份与恢复

| 层 | 机制 |
|---|---|
| 代码 | 本 GitHub 私有 repo（每次改版 push） |
| 数据库＋文件 | 每周一 07:30 执行计划“AiurCrystalBackup”，运行 `backup.ps1` → D1 完整 dump＋R2 文件 → OneDrive，保留 8 份 |
| 云端内置 | D1 Time Travel：可将整个数据库恢复至过去 30 天内的任意时间点 |
| Secrets | `.dev.vars` 保存在本地＋密码管理器备份 |

误删数据、重建机器、账号级灾难的完整恢复步骤见 **[BACKUP.md](BACKUP.md)**；建议每季度演练一次。

## 🕰 版本历史

| 版本 | 内容 | 规格 / 验收 |
|---|---|---|
| v1 | 平台核心：认证、权限、项目、看板、临床／BD 模块、仪表盘、cron、AI 快写／周报 | [SPEC](SPEC.md) / [验收](ACCEPTANCE.md) |
| v2 | 更名为艾爾水晶、自动进度、引导、多视图、甘特图、时间轴、留言提及、R2 文件、自动化、AI 三件套 | [SPEC](SPEC-V2.md) / [验收](ACCEPTANCE-V2.md) |
| v3 | 自助注册＋Email OTP＋管理员批准 | [SPEC](SPEC-V3.md) / [验收](ACCEPTANCE-V3.md) |
| v4 | 管理权转移＋最后一名管理员保护 | [SPEC](SPEC-V4.md) / [验收](ACCEPTANCE-V4.md) |
| v5 | Protoss 主题重塑（金色结构／蓝色能量／切角面板／护盾进度条） | [SPEC](SPEC-V5.md) / [验收](ACCEPTANCE-V5.md) |
| v6 | 团队账号、QA 证照有效期、CCR 变更控制、OKR、法规动态、批量导入 | [SPEC](SPEC-V6.md) / [验收](ACCEPTANCE-V6.md) |
| — | 六份 Excel 真实数据迁移（32 个项目／110 条进度／627 条法规，合并跨文件重复项） | [IMPORT.md](IMPORT.md) / [IMPORT-RUN.md](IMPORT-RUN.md) |
| v7 / v7.1 | 法规 AI 导入（文字／PDF）＋拆分粒度修正（单条＝一条） | [SPEC](SPEC-V7.md)·[7.1](SPEC-V7-1.md) / [验收](ACCEPTANCE-V7.md)·[7.1](ACCEPTANCE-V7-1.md) |
| v8 | 分组周报月报＋月报 cron、时间轴泳道＋任务条、全站字号、加粗 | [SPEC](SPEC-V8.md) / [验收](ACCEPTANCE-V8.md) |
| v9 | 繁中／English 双语（包括 AI 输出跟随）＋深色／浅色主题切换（CSS 变量 token 化） | [SPEC](SPEC-V9.md) / [验收](ACCEPTANCE-V9.md) |
| v9.1 | 登录／注册水晶图标改为共用的直立六面 Protoss 水晶 | [SPEC](SPEC-V9-1.md) / [验收](ACCEPTANCE-V9-1.md) |
| v10 | 法规公告日期校验＋多文件 AI 合并分析＋前后对照摘要与多附件 | [SPEC](SPEC-V10.md) / [验收](ACCEPTANCE-V10.md) |
| v11 | TFDA RSS 每日自动抓取＋AI 草稿 fallback＋人工审核发布 | [SPEC](SPEC-V11.md) / [验收](ACCEPTANCE-V11.md) |
| v11.1 | 勾选多条 TFDA 草稿批量批准／删除＋孤立附件清理 | [SPEC](SPEC-V11-1.md) / [验收](ACCEPTANCE-V11-1.md) |
| v11.2 | TFDA 驳回墓碑，防止已删除公告被 cron 重新创建 | [SPEC](SPEC-V11-2.md) / [验收](ACCEPTANCE-V11-2.md) |

## 🧭 开发模式

本项目采用**规格驱动＋双 agent 流水线**：Claude（编写规格、分配任务、独立验收）＋ OpenAI Codex（实现、部署、E2E 自验）。每个版本都有书面规格（`SPEC*.md`）和如实记录命令原始结果的验收文件（`ACCEPTANCE*.md`）；失败与未完成项一律留痕，不作粉饰。实现决策集中记录在 [DECISIONS.md](DECISIONS.md)。
