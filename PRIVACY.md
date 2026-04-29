# Vibe Check — Privacy Policy

Vibe Check optionally collects **anonymous usage events** to help us understand how the extension is used and where it breaks. This document is the complete, authoritative list of every field that leaves your machine.

**Telemetry is off by default.** On first activation you'll see a one-time prompt — `Allow`, `No thanks`, or `See what we collect`. Your choice is saved. Change it anytime:

- Run `Vibe Check: Telemetry Settings…` from the Command Palette.
- Or set `vibeCheck.telemetry.enabled` in Settings (`true`, `false`, or `null` to be re-prompted).

Vibe Check **also** honors VS Code's host-level telemetry switch (`telemetry.telemetryLevel`). If that is set to `off`, no events are sent regardless of our setting. This applies in every fork that implements the API — VS Code, Antigravity, Cursor, Windsurf, VSCodium, code-server, Trae, Theia.

---

## What we collect (when telemetry is enabled)

Every event has the following envelope:

| Field | What it is | Example |
|---|---|---|
| `anon_id` | Random UUID generated once per installation, stored locally in `globalState`. Not derived from your machine, hostname, OS user, or anything that could be reversed back to you. | `7f4c1a3e-…` |
| `session_id` | Random UUID generated fresh on every extension activation. | `9b2…` |
| `host` | Editor host: `vscode`, `antigravity`, `cursor`, `windsurf`, `vscodium`, `trae`, `theia`, `code-server`, or `unknown`. | `cursor` |
| `app_name` | `vscode.env.appName` — the editor's self-reported name. | `Cursor` |
| `app_version` | `vscode.version` — the editor's version string. | `1.95.2` |
| `ext_version` | Vibe Check version. | `0.1.0` |
| `os` | Operating system family: `win32`, `darwin`, or `linux`. Never the OS user, hostname, or release version. | `win32` |
| `client_ts` | Client timestamp when the event was queued. | `2026-04-29T10:00:00Z` |
| `name` | Event name from the catalog below. | `lesson.completed` |
| `props` | Event-specific anonymous properties. Strings are capped at 256 chars and a sanitizer drops any non-primitive values. | `{ correct: 4, total: 5, durationMs: 91234 }` |

## What we DO NOT collect — ever

- ❌ The contents of any code you write, paste, or generate
- ❌ The contents of any file in your workspace
- ❌ File paths, folder names, or repository names from your workspace
- ❌ The text of any quiz prompt, option, or answer
- ❌ Your API keys, secrets, environment variables, or anything from `SecretStorage`
- ❌ Your IP address (the receiver does not store it; it appears only briefly in TLS network logs)
- ❌ Your name, email, GitHub handle, OS username, hostname, or `vscode.env.machineId`
- ❌ Any contents of `vscode.env.machineId` — we use our own random `anon_id` instead

If we ever add a field to an event, we will add it to the table below in the same release and bump the `schema_version` field.

---

## Event catalog (schema v1)

### Lifecycle

| Event | Properties |
|---|---|
| `extension.activated` | `firstRun: boolean`, `secondsSinceLastActivation?: number` |
| `extension.deactivated` | `sessionDurationMs: number` |
| `host.detected` | `host: string`, `appName: string` |

### Consent

| Event | Properties |
|---|---|
| `consent.prompted` | `trigger: 'first-run' \| 'command'` |
| `consent.granted` | `trigger: 'first-run' \| 'command'` |
| `consent.denied` | `trigger: 'first-run' \| 'command'` |

### Setup / onboarding

| Event | Properties |
|---|---|
| `walkthrough.opened` | `source: 'first-run' \| 'command'` |
| `walkthrough.fallback_toast_shown` | — |
| `provider.configure_started` | `from: 'wizard' \| 'command' \| 'walkthrough'` |
| `provider.configure_completed` | `provider: string`, `model: string` |
| `provider.configure_canceled` | `atStep: 'provider' \| 'apiKey' \| 'model'` |
| `provider.api_key_set` | `provider: string` *(only the provider id, never the key itself)* |
| `provider.api_key_cleared` | `provider: string` |
| `provider.switched` | `from: string`, `to: string` |
| `provider.model_selected` | `provider: string`, `model: string`, `isCustom: boolean` |
| `provider.fallback_used` | `wanted: string`, `actual: string` |

### Modules and lessons

| Event | Properties |
|---|---|
| `module.generation_started` | `topic`, `track`, `source: 'manual' \| 'auto-pulse' \| 'selection'`, `mixed: boolean`, `contextChars: number`, `lessonCount`, `questionsPerLesson` |
| `module.generation_completed` | `topic`, `track`, `durationMs`, `lessons` |
| `module.generation_failed` | `topic`, `track`, `provider`, `errorClass` |
| `module.opened` | `lessonsTotal`, `lessonsCompleted` |
| `module.completed` | `totalLessons`, `totalQuestions` |
| `module.abandoned` | `atLessonIndex`, `lessonsCompleted`, `totalLessons` |
| `lesson.started` | `lessonIndex`, `questionCount`, `track`, `topic`, `isReview` |
| `lesson.exited` | `lessonIndex`, `answeredCount`, `totalQuestions` |
| `lesson.completed` | `lessonIndex`, `correct`, `total`, `passed`, `track`, `topic`, `durationMs`, `isReview` |

### Questions

| Event | Properties |
|---|---|
| `question.shown` | `type`, `track`, `topic`, `lessonIndex`, `questionIndex`, `isReview`, `hasCodeSnippet` |
| `question.answered` | `type`, `track`, `topic`, `correct`, `durationMs`, `attempts`, `isReview` |
| `question.why_clicked` | `type`, `wasCorrect` |
| `question.code_ref_clicked` | `type` |
| `question.code_show_clicked` | `type` |
| `question.tried_again` | `type` |

*(Note: question prompts, options, and code snippets are **never** sent. Only the type and counts.)*

### Reviews

| Event | Properties |
|---|---|
| `review.started` | `dueCount`, `track` |
| `review.completed` | `cardsReviewed`, `correct`, `durationMs`, `track` |
| `review.empty` | `track` |

### Track / progression

| Event | Properties |
|---|---|
| `track.switched` | `from`, `to` |
| `progress.daily_goal_met` | `track`, `dailyXp` |
| `progress.streak_extended` | `track`, `streakDays` |
| `progress.streak_broken` | `track`, `previousStreak` |
| `progress.reset` | — |

### Pulse (auto-detection of large AI insertions)

| Event | Properties |
|---|---|
| `pulse.observed` | `chars: number`, `lines: number`, `autoQuiz: boolean` |
| `pulse.dismissed` | — |
| `pulse.auto_fired` | `chars`, `lines` |
| `pulse.prompted` | `chars`, `lines`, `accepted` |

*(Note: only the `chars` and `lines` count of inserted code is sent. **The inserted code itself is never sent.**)*

### LLM transport

| Event | Properties |
|---|---|
| `llm.request_started` | `provider`, `model`, `kind: 'skeleton' \| 'lesson' \| 'explain'` |
| `llm.request_succeeded` | `provider`, `model`, `kind`, `durationMs`, `responseChars` |
| `llm.request_failed` | `provider`, `model`, `kind`, `durationMs`, `errorClass`, `statusCode?` |

### UI clicks and commands

| Event | Properties |
|---|---|
| `sidebar.opened` | — |
| `sidebar.button_clicked` | `button`, `screen` |
| `sidebar.picker_opened` | — |
| `command.invoked` | `command` |
| `setting.changed` | `key`, `valueClass` |

### Errors

| Event | Properties |
|---|---|
| `error.thrown` | `location`, `errorClass`, `provider?` |

---

## How events are transmitted

- Events are **batched** in memory + a local mirror in `globalState` (so a crash doesn't lose them).
- A flush fires every 30 seconds, or as soon as 20 events are queued.
- Each batch is sent as a single HTTPS POST to a Supabase REST endpoint.
- The Supabase project's anon key is `INSERT`-only via Row Level Security — even if the key is extracted from the extension bundle, no one can read or modify any data.
- On any non-2xx response or network error, the batch is dropped silently. We do **not** retry-loop on flaky networks.
- The maximum queue size is 200 events; beyond that, oldest events are dropped to keep memory bounded.

## Where the data lives

- **Receiver**: a Supabase project owned by Vibe Check's maintainer.
- **Database**: PostgreSQL. Single `events` table with `schema_version` for forward compatibility.
- **Retention**: events older than 180 days are deleted by a scheduled cron job.
- **Access**: only the maintainer has read access (via a separate service-role key kept locally and never embedded in the extension).

## Self-hosting / re-routing

If you want to point the extension at your own Supabase project, set `vibeCheck.telemetry.endpoint` to your `/rest/v1/events` URL. To hard-disable transport regardless of consent, set it to `disabled`.

## Contact

Issues, questions, deletion requests: <https://github.com/ekontoTURBO/vibe-check/issues>

If you want your `anon_id` purged from the database, open an issue with the id (you can copy it from a debug log) and we'll delete the rows.
