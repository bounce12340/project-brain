# 🔷 艾爾水晶 ("Aiur Crystal") — Project Progress

**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

**What this is**: an in-house project-tracking system for the regulatory (RA/PV), clinical, QA, and BD teams at UIC, a Taiwanese pharmaceutical agency. Progress is tracked through a Kanban board, list, calendar, Gantt charts, and a global timeline, with AI weekly reports and a TFDA regulatory watch layered on top. Technically it is a single Cloudflare Worker (Hono + D1 + R2) serving a React + TypeScript front end, shipped with one `wrangler deploy`. It is not a general-purpose SaaS — the fields, permission tiers, and workflows are shaped around how those four teams actually work.

> Like the Khala, it lets the team sense the pulse of every project together through the crystal.

**Production**: <https://projects.uic-ai.com> | **Version**: v12.2 | **Tests**: 420/420 ✅ | **Platform**: Cloudflare Workers

A shared project progress platform for the internal team of Taiwan-based pharmaceutical agency UIC. It replaces a fragmented workflow spread across six Excel files—where BD, RA, QA, and Clinical each worked in isolation and multiple people recorded the same project—with a single crystal for projects, progress, OKRs, regulatory updates, license expirations, and change control: real-time teamwide awareness, tiered permissions, AI assistance, and automated reminders.

## ✨ Feature Overview

- **Project management**: Teams (BD / Clinical / QA / RA-PV), three visibility levels (company-wide / same team / private), mutual editing support within a team, restricted visibility for interns, automatic/manual progress, milestones, and phase templates
- **Four task views**: Kanban (drag and drop) | List | Calendar | Gantt (dependency arrows + today line); the task drawer puts prerequisites before dates and suggests the day after their latest due date without overwriting a manually edited start date
- **OKRs**: Quarterly objectives + Key Results (owner / status / order), with completion incorporated into automatic progress
- **Dedicated modules**: Clinical enrollment (target vs cumulative, daily entries) | BD registration (case state machine, history, fees) | QA license expiration (tiered expiry alerts + automatic notifications) and CCR change control (`CCR-YYYY-NNN` state machine + history)
- **Regulatory updates**: A knowledge base of 600+ TFDA regulations dating back to 2018, sorted by announcement date with product-line/category/keyword filters; TFDA RSS is fetched daily into review drafts and published to all users only after approval; announcement text can also be pasted, or multiple files uploaded together, for AI-structured import
- **AI intelligence** (Ollama Cloud, deepseek-v4-pro): Progress drafting, task summaries, project risk forecasts, scheduling suggestions, and automatic weekly/monthly report generation
- **Automation**: “When…then…” rules engine; three cron jobs for daily TFDA RSS fetching + reminders, AI weekly reports (Monday), and AI monthly reports (the first day of each month)
- **Reports**: One-click team weekly/monthly reports + printing, CSV export, and a timeline with team swimlanes
- **Accounts**: Self-registration + Email verification code + administrator approval; administration transfer (co-administrator / full transfer) + safeguards for the last administrator
- **Interface**: StarCraft Protoss theme (gold = structure, blue = energy, chamfered panels, shield progress bars), dark/light themes, Traditional Chinese/English switcher, concrete inline help tips, two replayable guided tours, a scenario-based manual, and font-size controls

## 🏗 System Architecture

```mermaid
flowchart LR
  U[Browser SPA<br/>React + Protoss theme] -->|HTTPS<br/>projects.uic-ai.com| W[Cloudflare Worker<br/>Hono API + static assets]
  W --> D1[(D1 database<br/>27 tables)]
  W --> R2[(R2 files<br/>attachments/source announcements)]
  W -->|OpenAI compatible| LLM[Ollama Cloud<br/>deepseek-v4-pro]
  W -.->|no-key fallback| WAI[Workers AI<br/>Llama 3.3]
  CRON[Cron ×3<br/>daily/weekly/monthly] --> W
  W -->|reminders · reports · invitations| MAIL[AgentMail<br/>uic_ai@agentmail.to]
```

## 🧰 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 · Vite · TypeScript · Tailwind CSS · @dnd-kit (drag and drop) · Recharts (charts) · custom calendar/Gantt SVG |
| Backend | Cloudflare Workers · Hono · Workers Static Assets |
| Data | D1 (SQLite, raw SQL migrations) · R2 (files) · unpdf (PDF text-layer extraction) |
| AI | OpenAI-compatible layer (Ollama Cloud `deepseek-v4-pro`) + Workers AI fallback |
| Email | AgentMail REST API |
| Authentication | PBKDF2-SHA256 (WebCrypto) · httpOnly session cookie · Email OTP |
| Testing | Vitest 270 tests (permission matrix, state machines, i18n key parity, theme contrast, algorithms, import idempotency) |

## 📁 Project Structure

```
worker/            # Hono API：routes、middleware、services（permissions/llm/mailer/crypto…）
src/               # React SPA：pages、components、Protoss design tokens
migrations/        # D1 migrations 0001–0011
tests/             # Vitest（＋fixtures）
scripts/           # 各版正式站 E2E 驗收腳本
SPEC*.md           # 各版規格書（開發都由規格驅動）
ACCEPTANCE*.md     # 各版驗收證據（指令與結果原文）
IMPORT.md          # 批次匯入 JSON 合約
BACKUP.md          # 備份與還原手冊
backup.ps1         # 每週自動備份（D1 dump + R2 → OneDrive）
DECISIONS.md       # 實作決策紀錄
```

## 🚀 Local Development

```powershell
npm install
npx wrangler types
npx wrangler d1 migrations apply project-brain-db --local
npm run dev
```

Local Worker integration test:

```powershell
npm run build
npx wrangler dev --local
```

Quality checks:

```powershell
npm run typecheck
npm test
npm run build
```

`.dev.vars` contains only `LLM_API_KEY` and `AGENTMAIL_API_KEY` and is ignored by Git. Never put their values in `wrangler.jsonc`, the README, logs, or commits.

## ☁️ Deployment

Merging to `main` deploys through GitHub Actions: tests pass, migrations apply, `wrangler deploy` runs, and the workflow then fetches the live entry chunk and compares it against the build — a deploy only counts as successful once production actually serves it.

Two repository secrets are required (Settings → Secrets and variables → Actions):

| Secret | Contents |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Needs Account → Workers Scripts → Edit, Account → D1 → Edit, and Zone → Workers Routes → Edit (for the custom domain; without it the final deploy step fails) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

The workflow can also be triggered by hand from the Actions tab. To deploy locally instead:

```powershell
npx wrangler d1 migrations apply project-brain-db --remote
npx wrangler deploy
```

Secrets must be read from `.dev.vars` and passed to Wrangler through stdin; do not place them in command arguments or output. After deployment, use `npx wrangler secret list` to confirm that only their names are shown.

**Changing the LLM model**: Change `vars.LLM_MODEL` in `wrangler.jsonc` (also change `vars.LLM_BASE_URL` when switching endpoints) → `typecheck` + `build` + `deploy`. The system calls the OpenAI-compatible endpoint first and falls back to Workers AI when `LLM_API_KEY` is absent.

**Restoring the custom domain binding**: `projects.uic-ai.com` is currently bound. If the Worker is rebuilt in the future and the custom domain fails, remove `routes`, deploy to workers.dev, then manually add the domain in Dashboard → Workers → project-brain → Settings → Domains & Routes. Finally, restore `APP_BASE_URL` and redeploy.

## ⏰ Schedule (UTC cron ↔ Taipei Time)

| Cron | Taipei time | Task |
|---|---|---|
| `0 1 * * *` | Daily at 09:00 | Fetch TFDA RSS first to create review drafts, then process milestone/to-do/BD inactivity/QA license expiration/project inactivity/automatic archiving reminders and the consolidated Email; fetch failures do not interrupt reminders |
| `30 0 * * 1` | Every Monday at 08:30 | AI weekly reports for the whole company and each team for the previous week |
| `30 0 1 * *` | First day of each month at 08:30 | AI monthly reports for the whole company and each team for the previous month |

If the LLM fails, a data-only version of the report is still saved. Pre-generated reports always exclude private projects and include a note to that effect at the end. If AgentMail is not configured, only Email delivery is skipped; in-app notifications are unaffected.

## 🔐 Accounts and Permissions

### Registration and Approval

On the login page, employees select “Request an account”: name + company Email + password + team → six-digit Email verification code (15 minutes) → pending approval. Under “Administration → Registration requests,” an administrator approves (optionally adjusting the role/team) or rejects the request, and the result is sent by Email; the account cannot sign in before approval. Abuse prevention: a 60-second resend cooldown per Email, no more than five verification attempts, and a daily limit per IP. Administrators can also create accounts directly (a password change is required on first sign-in).

### Administration Transfer

Under “Administration → Administration transfer,” choose **co-administrator** (the other person is promoted to admin; your role is unchanged) or **full transfer** (atomically promote first, then demote). Both require re-entering your own password. At the API layer, the system prevents the last active admin from being demoted or deactivated.

### Permission Quick Reference

| Action | admin | owner | same-team member | project member | intern |
|---|---|---|---|---|---|
| View `all` | All | ✔ | ✔ | ✔ | Assigned projects only |
| View `group` | All | ✔ | ✔ | ✔ | Assigned projects only |
| View `private` | All | ✔ | ✘ | ✔ | Assigned projects only |
| Enter progress/tasks/Kanban/enrollment/BD events | All | ✔ | ✔ | ✔ | Assigned projects only |
| Edit/delete a progress update | All | Any update | Own updates only | Own updates only | Own updates in assigned projects |
| Change visibility/members/archive/delete | All | ✔ | ✘ | ✘ | ✘ |
| View and enter BD fees | All | ✔ | Same-team employees | Not available across teams | ✘ |
| Regulatory published list | All | ✔ | ✔ | ✔ | ✔ |
| View/approve TFDA drafts | All | — | RA/PV employees only | ✘ | ✘ |

The backend API rechecks each permission individually (centralized in `worker/services/permissions.ts`, with 27 matrix test groups); hiding buttons in the frontend is not the only line of defense. Lists, dashboards, timelines, and reports for an intern aggregate only the projects visible to that intern.

### Demo Accounts (for permission verification; password: `Brain-2026!`; remove via “Administration → Clear demo data” after production launch)

| Role | Email | Name |
|---|---|---|
| Clinical member | `clinical1@demo.local` | 林曉臨 |
| Clinical member | `clinical2@demo.local` | 陳收案 |
| BD member | `bd1@demo.local` | 王必達 |
| Clinical intern | `intern1@demo.local` | 李實習 |

## 📖 Everyday Usage Guide

### Language and Theme (English / Dark‧Light)

**How to switch**: Two adjacent buttons appear at the top right of the navigation bar:

1. “**中／EN**”: Switches the entire interface between Traditional Chinese and English (navigation, buttons, forms, help pages, guided tour, and relative times are all translated).
2. “**☀／🌙**”: Instantly switches between dark (Protoss deep space, the default) and light (daylit temple—warm ivory background, gold structure, deep psi blue) themes. Charts, Gantt, timeline, risk badges, and shield progress bars change colors together without flashing.

**How preferences are remembered**: Preferences are stored in each browser’s localStorage (`AIUR_LANG` / `AIUR_THEME`), so they do not affect colleagues. A new device or cleared cache returns to the default, “Traditional Chinese + dark.”

**Translation scope and boundaries**:

- Follows the selected language: Interface text, the entire `/help` page, the first-time tour, and personal real-time AI output (progress drafting, task summaries, risk forecasts, scheduling rationale).
- Always in Traditional Chinese: User-entered data (project names, progress, comments, regulatory entries), Email notifications, organizational weekly/monthly reports, and regulatory AI import results.
- Printing always uses a white background and is unaffected by the theme.

### Projects, Tasks, and Automatic Progress

1. Under “Projects → New project,” set the team, visibility, target date, and phase template.
2. On “Overview,” switch between manual and automatic progress. Automatic mode = completion ratio of tasks + milestones + linked to-dos + KRs (the default for new projects). History events are completed facts for past dates and are always excluded from progress, overdue KPIs, and reminders.
3. Switch freely among the four views under “Tasks.” Kanban supports dragging phases and cards. Select a task to open the drawer and edit its content, owner, start/end dates, and dependencies, or use comments with `@mentions`, attachments, and AI summaries. A milestone or history event with only its due/event date stays a point; set the optional end date to show it as a daily calendar range and a Gantt bar with diamond endpoints. Completed task bars use hatching, while overdue unfinished tasks and milestones have a red end marker.
4. Paste rough notes into “Progress log,” use “AI drafting” to organize them into a three-part draft, then review and publish it.
5. The author, project owner, or an administrator can use the controls at the top right of an update to edit it inline or delete it. Editing preserves the original progress snapshot and adds an edit timestamp. Deletion is irreversible, but the audit trail remains; deleting an automatically generated completion log does not revert the task or milestone.
6. After the update is saved, AI may suggest marking explicitly completed tasks as done, creating follow-up tasks or future milestones, recording past completed facts as history events, and setting dates on existing unfinished tasks. Suggestions never write data by themselves: every checkbox starts clear, and only “Apply selected” sends existing task/milestone endpoints. Suggested titles and dates remain editable; history events also offer select-all for larger imports. A past dated fact never becomes a milestone and never changes progress. Disable this prompt under Profile (`AIUR_PROGRESS_LINKS`, enabled by default).

Server timestamps are stored as UTC and all interface timestamps are displayed in `Asia/Taipei`; date-only project and task dates remain Taipei calendar dates.

### Files, Automation, and AI

- Files are stored in R2 (25 MB per file), and downloads require a permission check; the uploader, owner, or admin can delete them.
- “Automation” rules: Task completed / moved into a phase / milestone completed / progress crosses a threshold → notify / reassign / create a to-do / write a log entry.
- “AI risk forecast” on the project overview saves a level + recommendation and displays it on the dashboard. “AI scheduling suggestions” can be applied only after backend validation (dates stay within the project and do not violate dependencies).

### AI Import of Regulatory Updates

Paste announcement text or upload up to five `.txt` / text-layer `.pdf` files together (10 MB per file, 25 MB total). **Single announcement** (default): entire package → one entry; **multiple-announcement digest**: split only when announcement dates or titles differ.

`entry_date` always uses the announcement/issue date, never the implementation/effective date; the implementation date appears as the first bullet after the summary. If the date extracted by AI is more than 90 days in the future, the preview displays a warning color but does not block editing or import. Material containing “comparison table / amended provisions / current provisions” receives a separate “Key amendments (before-and-after comparison)” section and up to 10 “old rule → new rule” summaries.

Preview cells can be edited or excluded individually. On confirmation, duplicates are detected by `(entry_date, title)`. All source files are stored in R2; the list displays `📎×N`, with each file available for download. Deleting the last referencing entry also removes the D1 relationship and the orphaned R2 object. For scanned PDFs without a text layer, paste the text instead (OCR is intentionally not supported).

### Automatic TFDA RSS Fetching and Review

The 09:00 daily pre-processing step reads the TFDA announcement RSS feed. RA/PV employees and admins can also select “Fetch TFDA now” under Regulatory updates. The system uses three-way deduplication—existing TFDA news id, rejection tombstones, and `(announcement date, title)`—then sends the full announcement text (including table rows) through the existing single-announcement AI pipeline. If AI is temporarily unavailable, it still creates a draft under “Other” using the first 500 characters of the source, so announcements are not missed.

New data is always created as a `TFDA draft`; reviewers receive an in-app notification included in the daily Email digest. Authorized users can select “N awaiting review” to expand the full key points, edit entries (which remain drafts), approve/delete entries individually, approve/delete multiple selected entries in a batch, or approve all after confirmation. Other members and all interns cannot see entries at all until approval. Only then do they enter the regular published list. When a TFDA draft or published entry is deleted, the source-ref tombstone is retained first, preventing a later cron run from recreating the same announcement; manual entries are unaffected. During operation and acceptance testing, never approve or delete genuine TFDA drafts on behalf of business users.

### Reports and Timeline

- “Reports → Generate report”: Select a team + (this week / last week / this month / last month) to generate a report with one click; printing is supported. Members are limited to their own team, while admins can choose the whole company or a version that includes private projects.
- “Timeline”: Team swimlanes show all visible projects, and expanded rows display task bars (owner tooltip).

### Teams and Phase Templates (Administrators)

The type under “Administration → Teams” (`clinical` / `bd` / `qa` / `general`) determines the dedicated module; a team that is referenced cannot be deleted. In “Phase templates,” separate phases with `→`. Applying a template copies it, so later template changes do not affect existing projects.

## 💾 Backup and Restore

| Layer | Mechanism |
|---|---|
| Code | This private GitHub repo (pushed with every release) |
| Database + files | The weekly “AiurCrystalBackup” schedule runs `backup.ps1` every Monday at 07:30 → full D1 dump + R2 files → OneDrive, retaining 8 copies |
| Cloud-native | D1 Time Travel: restore the entire database to any point within the past 30 days |
| Secrets | `.dev.vars` stored locally + backed up in a password manager |

For complete recovery steps after accidental data deletion, machine rebuilds, or account-level disasters, see **[BACKUP.md](BACKUP.md)**. A drill once per quarter is recommended.

## 🕰 Version History

| Version | Description | Specification / Acceptance |
|---|---|---|
| v1 | Platform core: authentication, permissions, projects, Kanban, Clinical/BD modules, dashboard, cron, AI drafting/weekly reports | [SPEC](SPEC.md) / [Acceptance](ACCEPTANCE.md) |
| v2 | Renamed 艾爾水晶, automatic progress, guided tour, multiple views, Gantt, timeline, comment mentions, R2 files, automation, and the three-part AI toolkit | [SPEC](SPEC-V2.md) / [Acceptance](ACCEPTANCE-V2.md) |
| v3 | Self-registration + Email OTP + administrator approval | [SPEC](SPEC-V3.md) / [Acceptance](ACCEPTANCE-V3.md) |
| v4 | Administration transfer + last-administrator safeguards | [SPEC](SPEC-V4.md) / [Acceptance](ACCEPTANCE-V4.md) |
| v5 | Protoss theme redesign (gold structure / blue energy / chamfered panels / shield progress bars) | [SPEC](SPEC-V5.md) / [Acceptance](ACCEPTANCE-V5.md) |
| v6 | Team accounts, QA license expiration, CCR change control, OKRs, regulatory updates, batch import | [SPEC](SPEC-V6.md) / [Acceptance](ACCEPTANCE-V6.md) |
| — | Migration of real data from six Excel files (32 projects / 110 progress entries / 627 regulations, with cross-file duplicates merged) | [IMPORT.md](IMPORT.md) / [IMPORT-RUN.md](IMPORT-RUN.md) |
| v7 / v7.1 | Regulatory AI import (text/PDF) + split-granularity correction (one announcement = one entry) | [SPEC](SPEC-V7.md)·[7.1](SPEC-V7-1.md) / [Acceptance](ACCEPTANCE-V7.md)·[7.1](ACCEPTANCE-V7-1.md) |
| v8 | Team weekly/monthly reports + monthly-report cron, timeline swimlanes + task bars, sitewide font sizing and bold text | [SPEC](SPEC-V8.md) / [Acceptance](ACCEPTANCE-V8.md) |
| v9 | Traditional Chinese/English interface (including matching AI output) + dark/light theme switcher (CSS variable tokens) | [SPEC](SPEC-V9.md) / [Acceptance](ACCEPTANCE-V9.md) |
| v9.1 | Login/registration crystal icon replaced with the shared upright six-faceted Protoss crystal | [SPEC](SPEC-V9-1.md) / [Acceptance](ACCEPTANCE-V9-1.md) |
| v10 | Safeguards for regulatory announcement dates + multi-file AI combined analysis + before-and-after summaries and multiple attachments | [SPEC](SPEC-V10.md) / [Acceptance](ACCEPTANCE-V10.md) |
| v11 | Daily automatic TFDA RSS fetching + AI draft fallback + manual review and publication | [SPEC](SPEC-V11.md) / [Acceptance](ACCEPTANCE-V11.md) |
| v11.1 | Select multiple TFDA drafts for batch approval/deletion + orphaned-attachment cleanup | [SPEC](SPEC-V11-1.md) / [Acceptance](ACCEPTANCE-V11-1.md) |
| v11.2 | TFDA rejection tombstones prevent cron from reviving deleted announcements | [SPEC](SPEC-V11-2.md) / [Acceptance](ACCEPTANCE-V11-2.md) |
| v12 | Progress updates produce AI task-link suggestions that require explicit human checkbox confirmation | [SPEC](SPEC-V12.md) / [Acceptance](ACCEPTANCE-V12.md) |
| v12.1 | Progress updates can be edited or deleted by their author, project owner, or admin, with immutable snapshots and an audit trail | [SPEC](SPEC-V12-1.md) / [Acceptance](ACCEPTANCE-V12-1.md) |
| v12.2 | Fixes Taipei timestamp display and duplicate quick submissions; progress can suggest milestones and dates for existing tasks | [SPEC](SPEC-V12-2.md) / [Acceptance](ACCEPTANCE-V12-2.md) |
| v12.4 | Past completed facts become history events on calendars and Gantt while remaining excluded from progress and reminders | [SPEC](SPEC-V12-4.md) / [Acceptance](ACCEPTANCE-V12-4.md) |
| v12.5 | The task drawer is dependency-first and continues start dates from prerequisites while preserving manual edits | [SPEC](SPEC-V12-5.md) / [Acceptance](ACCEPTANCE-V12-5.md) |
| v13.2 | Milestones and history events support optional date ranges; Gantt adds larger labels, completed hatching, and overdue end markers | [SPEC](SPEC-V13-2.md) / [Acceptance](ACCEPTANCE-V13-2.md) |

## 🧭 Development Model

This project follows a **specification-driven, dual-agent pipeline**: Claude (specification writing, work assignment, independent acceptance) + OpenAI Codex (implementation, deployment, E2E self-verification). Each release has a written specification (`SPEC*.md`) and an acceptance file (`ACCEPTANCE*.md`) that faithfully records commands and their raw results. Failures and incomplete items always remain visible and are never glossed over. Implementation decisions are centralized in [DECISIONS.md](DECISIONS.md).
