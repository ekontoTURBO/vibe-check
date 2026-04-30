# Changelog

All notable changes to Vibe Check are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2]

### Added
- **Difficulty chip on every module card** (BEG / INT / EXP). Now that modules are shared across tracks you can tell at a glance which difficulty each one was generated at
- **Track chip in the question header** so you always know which difficulty you're answering at
- **Delete a module** — small ✕ button on each module card with a confirm prompt. Removes the module *and* its associated FSRS review cards. Replaces the previous all-or-nothing `Reset Progress` for cleanup
- **Empty state for zero modules** — friendly idle-mascot illustration with a prominent **+ NEW MODULE** call-to-action. First-impression for fresh workspaces is now ~30× better
- **Cancel-generation button** on the GENERATING overlay. Lightweight cancel — discards the in-flight result so you can retry immediately. (Proper HTTP-level abort coming in v0.1.2)
- **Keyboard shortcuts in lessons** — press `1` / `2` / `3` / `4` to pick A / B / C / D, `Enter` to submit when ready, `Enter` again to advance after feedback. The submit button shows ` ⏎` so users discover it
- **Thumbs up/down on every question** — pixel-art icons matching the rest of the UI. Telemetry-only. Helps surface bad LLM-generated questions in the dashboard so the prompts can be tuned. Local-only state; once rated, the buttons lock in
- **Next-lesson prefetching** — while you're on lesson N, the next lesson's questions are generated in the background. By the time you pass and unlock lesson N+1, it opens instantly with no LLM wait. Silent failure — if prefetch fails you just get the normal generation when you reach it
- **Streak freeze** ❄ — earn 1 freeze per 7-day streak (cap 3). If you miss a day with a freeze in hand, the streak is preserved automatically on your next review. Visible in the header next to the day-streak count when ≥ 1 is available

### Changed
- **XP, streak, daily progress, modules, and review queue are now SHARED across all three difficulty tracks.** Beginner / Intermediate / Expert is now purely a difficulty preference for newly generated lessons (still affects question difficulty and the XP rate per correct answer — 5 / 10 / 20). Everything else — your lifetime XP, your streak, the modules you see in the sidebar, the questions due for review — is one shared user-level pool.
- **Auto-migrates from v0.1.0 and earlier**: if you had three separate per-track progress entries, they're combined on first read. Lifetime XP and total-answered values are summed across tracks; streak takes the max of the three; today's daily XP sums the three tracks' contributions if any were earned today.
- **New pixel-art Glitch mascot** rolled out everywhere — 18×16 grid, antenna LED, single big screen-eye composed from base + eye + mouth + antenna. The marketplace icon and all in-app mascot states use the same composition system

### Fixed
- **First click on a question was sometimes silently dropped** — required a double-click to actually select an option on the first question of a lesson and on every transition between questions. Root cause: the local-state cleanup subscriber was registered after the render subscriber, so it was nulling out the selection object that the freshly-rendered click handlers had just captured in closures. Fix: cleanup now runs before render, and triggers only on lesson change (not on intra-lesson question advances).
- **Lessons that had only 1 question** would auto-complete immediately after the first answer (jump straight to summary). Now the parser enforces a minimum of 2 questions per lesson; if the model returns fewer it auto-retries once with a stricter prompt. Lessons saved with the old 1-question shape automatically regenerate when opened
- **JSON parse failures during lesson generation** — now solved at the source for providers that support it, plus a bulletproof shape-aware parser as defense-in-depth. The architectural shift: instead of trusting the *first* JSON object the model emits, the parser now extracts every balanced `{...}` candidate and returns the **first one with the expected shape** (`questions: array` for lessons, `lessons: array` for skeletons). This makes the parser provider-agnostic — it correctly skips reasoning/thinking content even when future models invent new ways to leak it. Specific layers:
  - **(0) Native strict-JSON mode where supported.** Skeleton and lesson calls ride on each provider's structured-output API — Gemini's `responseMimeType: application/json` and OpenAI/OpenRouter's `response_format: { type: 'json_object' }`. This eliminates markdown fences and prose prefixes before they reach the parser. `explainWrongAnswer` (prose) deliberately doesn't set the flag.
  - **(1) Provider-side noise filtering.** Gemini provider now drops `thought: true` parts (`gemini-2.5-flash` thinking enabled by default — the actual root cause of the friend's "huge repo" bug). Anthropic provider explicitly filters to `type: text` blocks, excluding extended-thinking blocks. Both providers now surface specific finishReason / stop_reason errors (MAX_TOKENS, SAFETY, RECITATION, refusal) instead of generic "no text content"
  - **(2) Quote-aware balanced-brace scanner.** Tracks both `"`-delimited and `'`-delimited strings so a `}` inside a single-quoted string no longer truncates the scanner mid-object
  - **(3) Shape-aware candidate selection.** Walks every parseable `{...}` in order, returns the first one matching the caller's shape validator. If the model emits `<thinking with code>{actual answer}`, the thinking content is correctly skipped even if it parses as JSON
  - **(4) Tolerant repair pass.** Strips BOM / zero-width chars, converts smart quotes (`""''`) to ASCII, rewrites single-quoted JSON strings to double-quoted (preserving apostrophes inside double-quoted strings), strips line/block comments, removes trailing commas, quotes unquoted property names
  - **(5) Self-diagnosing errors.** When parsing fails, the user-visible error now includes a snippet of what the model actually returned — no need to open DevTools. Distinguishes "model returned nothing" / "model is thinking out loud" / "model returned malformed JSON" / "model refused" with specific guidance for each
  - Verified against a 28-fixture smoke test ([scripts/smoke-test-json-parser.mjs](scripts/smoke-test-json-parser.mjs)) covering Gemini thinking, Anthropic thinking, OpenAI o1 reasoning prefixes, single-quoted strings with embedded `}`, multiple top-level objects, BOM, smart quotes, and combined-nightmare inputs
- **"Couldn't find X in any open file" when clicking inline code references** — now scans the whole workspace (up to 200 files, ignoring `node_modules` / `dist` / lock files / binaries) when the snippet isn't in any open editor. Prioritises `package.json` and `README.md` first, then config files, then source files. Especially helpful for Architecture-topic questions referencing npm scripts in closed `package.json` files
- **Error banner in the sidebar** now has an explicit ✕ close button on the right; clicking the message body no longer dismisses it (so you can read the full text without accidentally closing it)

## [0.1.0]

### Added
- **Anonymous, opt-in telemetry pipeline.** First-run prompt asks once, stored decision is honored thereafter. Toggle anytime via `Vibe Check: Telemetry Settings…` or `vibeCheck.telemetry.enabled`. Defaults to **off** until the user explicitly grants consent.
  - Honors `vscode.env.isTelemetryEnabled` (host-level kill-switch) in addition to our own setting — works across VS Code, Antigravity, Cursor, Windsurf, VSCodium, code-server.
  - Defensive event queue: batches every 30s or 20 events, persists to `globalState` (survives crashes), drops on overflow / network error (no retry-loop). All `track()` calls fire-and-forget so telemetry can never block or crash the extension.
  - Sanitizer caps strings at 256 chars and drops anything that isn't a primitive — code, file paths, API keys cannot reach the wire even if a future event were misused.
- **Cross-fork host detection.** New `EnvironmentDetector.host()` returns `vscode | antigravity | cursor | windsurf | vscodium | trae | theia | code-server | unknown`. Used by telemetry to slice metrics per fork in the dashboard.
- **`PRIVACY.md`** with the complete event catalog, retention policy, and how to opt out / request data deletion.
- **`Vibe Check: Telemetry Settings…`** command — quick-pick UI to grant / deny / reset consent or open the privacy policy.
- **`vibeCheck.telemetry.endpoint` setting** for power users who want to point the extension at their own Supabase instance, or set `disabled` to hard-disable transport regardless of consent.

### Changed
- Consent prompt fires 2.5s after activation so it doesn't fight the welcome walkthrough.
- `deactivate` now flushes the telemetry queue with a bounded timeout before VS Code shuts down the extension host.
- Bumped to v0.1.0 to mark the first non-prerelease minor — the privacy contract is now durable.

## [0.0.6]

### Changed
- **Quizzes are now scoped per project**, not global. When you open a different workspace, you'll see zero quizzes — only the ones you generated in *that* project. This was the most-requested behavior change because seeing modules from unrelated codebases in your current project's sidebar made no sense (and the 📍 SHOW button often pointed to files that weren't in the workspace).
  - **Per-project (workspace state)**: modules, lesson questions, FSRS review cards
  - **Global (user state, syncs across devices)**: XP, streak, daily progress, active track — that's *you*, not the project
- **Migration note**: existing modules saved before v0.0.6 lived in global state. After upgrading, those modules become orphaned (not deleted, just invisible) since no workspace claims them. Easy cleanup: run `Vibe Check: Reset Progress` once to wipe both layers, then start fresh per workspace.

## [0.0.5]

### Added
- **Fill-in-the-blank questions** — third question type. Code snippet shown with a highlighted gap; pick from a/b/c/d what completes it. Used for control-flow conditions, expression choices, missing args
- **Drag-and-drop reorder** for code-order questions. Replaces the ▲/▼ arrow buttons. Cyan drop indicator above/below target row. Drag handle (⋮⋮) on the left of every row
- **Inline code preview for MC questions** — when a multiple-choice question references a `lineRange`, the actual code block now renders directly in the question card. Code-frame has a header bar with line range chip and 📍 SHOW button (no longer overlaps the code), wraps instead of horizontal-scrolling
- **Multi-topic auto-fired modules** — when an AI agent inserts a chunk and Vibe Check auto-fires, lessons now span different angles (code → security → architecture → tools → code-deep) instead of all being about the same topic. Manual modules from the picker stay single-topic
- **Dynamic lesson and question counts** — the module now scales to the size of the inserted code:
  - `< 800 chars` → 2 lessons × 3 questions (= 6 total)
  - `< 2500 chars` → 3 × 4 (= 12)
  - `< 6000 chars` → 4 × 5 (= 20)
  - `≥ 6000 chars` → 5 × 5 (= 25)
  Tiny dumps no longer get padded with trivia just to fill 25 questions
- **New Glitch mascot** — full redesign on an 18×16 grid. Single big screen-eye, antenna LED that recolors per mood, hard drop shadow. 9 moods now (added `focus`, `sleep`, `load` for future states) composed from base + eye + mouth + antenna overlays
- **New marketplace icon** — generated from the new mascot's WIN mood (star eyes + grin)
- **Idle mascot in README** — centered hero image
- **Marketplace screenshots** — 5 curated screenshots in `media/screenshots/` covering home, module path, MC question, wrong-answer feedback, and lesson complete
- **Dismissible error banner** — errors now have an explicit ✕ close button on the right; clicking the message body no longer dismisses (so you can read the full text)

### Changed
- **Major lesson-prompt overhaul.** Hard quality rules now baked into the prompt: NEVER ask about variable names, comments, color values, casing, line counts, magic numbers, string literals, or filenames. ALWAYS ask about behavior, control flow, edge cases, side effects, and design intent. MC questions are now required to reference a meaningful code block (≥3 lines), not a single token
- **Architecture topic now reads entry-point files**, not just the directory tree. Pulls in `package.json` (trimmed), `tsconfig.json`, `README.md`, `src/index.ts`, `src/extension.ts`, `Cargo.toml`, `go.mod`, etc. — gives the model real substance to quiz on instead of a folder list
- **Anti-refusal directive** in the lesson prompt — the model is now explicitly told NOT to return prose excuses about thin context. Even minimal context supports questions about file roles, directory ownership, config flag meaning. Combined with a refusal-detector in the parser that surfaces a friendlier error message
- **Option-shuffle** — multiple-choice and fill-blank options are now shuffled with a seeded Fisher-Yates after the model returns. Defeats the well-known LLM bias toward `correctIndex: 0`. Distribution is now ~25% each across A/B/C/D
- Token budget for lesson generation now scales with question count instead of a flat 1500
- Skeleton prompt now generates the requested lesson count instead of always emitting 5
- Module success toast shows actual lesson count instead of hardcoded "5"

### Fixed
- `MultipleChoiceQuestion`'s `lineRange` was previously dead — the `codeForMC` constant in `lesson.ts` was always `undefined` regardless of input. Now properly slices the referenced lines from the module context and renders them inline
- **📍 SHOW highlight stuck after first click** — `setDecorations` was being called on a stale editor handle when the doc was already open, causing subsequent clicks to scroll without re-painting the highlight. Now clears all glows first, prefers `activeTextEditor`, defers the decoration to next tick
- **Sidebar scrolled to top on every option click** — the renderer was creating a fresh `#vc-screen` element each render, resetting `scrollTop`. Now snapshots scroll position before re-render and restores it on the new node, keyed per screen so navigating between Q1 → Q2 still starts at top

## [0.0.4]

### Added
- Persistent **Buy Me a Coffee** footer in the sidebar — small pixel-style link, always visible at the bottom regardless of which screen you're on. Clicking it opens the support page in your default browser via `vscode.env.openExternal` (the secure host-side path; the URL never bypasses the webview/host boundary)

## [0.0.3]

### Security
- **Gemini provider now sends the API key in the `x-goog-api-key` header** instead of the `?key=...` URL query parameter. URL-based auth could end up in HTTP proxy logs and Node fetch error messages. Header-based auth doesn't. Affects only the Gemini direct provider; Anthropic / OpenAI / OpenRouter were always header-based. **If you used Gemini in v0.0.1 or v0.0.2 from a network with a logging proxy**, consider rotating your Gemini API key as a precaution.

## [0.0.2]

### Added
- **Get Started walkthrough** that auto-opens on first install — 5-step guided onboarding (pick provider → pick track → first module → SRS overview → tips). Re-openable via `Vibe Check: Open Get Started Walkthrough`. Falls back to a toast if the host doesn't support the walkthrough API
- New **`Vibe Check: Configure Provider`** setup wizard — single guided flow that picks provider, prompts for API key (encrypted SecretStorage), and selects a model
- Expanded Infrastructure topic to recognize ~75 build/config files across JS/TS, Python, Rust, Go, Java/Kotlin (Maven + Gradle), .NET, Ruby, PHP, C/C++, Swift, Elixir, Haskell, Dart/Flutter, plus CI configs for GitHub Actions, GitLab, CircleCI, Azure Pipelines, Jenkins, Drone, Travis
- Last-chance fallback scan for any config-shaped file at the workspace root if the curated list misses
- **Code, Security, and Tools topics now scan the workspace** when nothing else fits — `Code`/`Security` look in `src/`, `lib/`, `app/`, `source/`, then root for source files (35+ extensions); `Tools` recognises `package.json`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle{.kts}`, `pubspec.yaml`, `Package.swift`, `mix.exs`, `deno.json`, `bunfig.toml`
- **Built-in AI auto-detection** — the `copilot` provider now tries any `vscode.lm` vendor, not just `copilot`. In Antigravity / Cursor / Windsurf etc. this means the host's built-in AI is used automatically, no API key required, just like Copilot in VS Code

### Changed
- **Default Gemini model** changed from `gemini-3-flash-preview` (preview, sometimes inaccessible to free-tier keys) to `gemini-2.5-flash` (stable, free-tier accessible)
- All `vibeCheck.<provider>Model` setting descriptions rewritten to be unambiguous about API key placement — clear separation between "model id" and "API key", with explicit step-by-step setup instructions
- Better error message when Infrastructure/Security topic finds no config files — lists what we looked for and suggests workarounds
- Security topic now skips its previous untitled-document branch — only uses the editor when it's a real file with substantial content
- Topic picker no longer grays out `Code`/`Tools` when only a workspace folder is open (no `package.json`, no active editor) — they now have workspace-scan fallbacks
- Provider label updated: `copilot` is now `VS Code LM (Copilot / built-in AI)` to reflect that it covers Antigravity/Cursor/Windsurf built-ins, not just GitHub Copilot
- Defensive fix: moved decoration-options access out of module top-level into a function, eliminating a class of activation-time crashes

## [0.0.1]

### Added
- Pixel-art UI inspired by Stardew/Celeste — Glitch mascot in 6 moods, stepped corners, hard drop shadows, `steps(N)` animations
- Provider abstraction: GitHub Copilot, Antigravity AI, Anthropic Claude, Google Gemini, OpenAI, OpenRouter
- API keys stored in encrypted SecretStorage; one-time migration from plain settings
- Live model picker — fetches `/v1/models` per provider with curated fallback and `Other…` for custom ids
- Auto-fire on large AI insertions (configurable via `vibeCheck.autoQuiz`)
- Optional personalized wrong-answer feedback via `? WHY` button (saves tokens by default)
- Clickable inline code references in question prompts — open the source file at the exact text
- Daily XP ring + per-track streaks
- Press Start 2P and JetBrains Mono shipped locally for offline use

### Token economics
- Lesson generation tightened to 1500 max output tokens
- Context capped at 5 KB per file, 16 KB total per generation
