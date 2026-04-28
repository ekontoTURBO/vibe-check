# Changelog

All notable changes to Vibe Check are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5]

### Added
- **Fill-in-the-blank questions** — third question type. Code snippet shown with a highlighted gap; pick from a/b/c/d what completes it. Used for control-flow conditions, expression choices, missing args
- **Drag-and-drop reorder** for code-order questions. Replaces the ▲/▼ arrow buttons. Cyan drop indicator above/below target row. Drag handle (⋮⋮) on the left of every row
- **Inline code preview for MC questions** — when a multiple-choice question references a `lineRange`, the actual code block now renders directly in the question card. Click 📍 SHOW to jump to it in the editor
- **Multi-topic auto-fired modules** — when an AI agent inserts a chunk and Vibe Check auto-fires, lessons now span different angles (code → security → architecture → tools → code-deep) instead of all being about the same topic. Manual modules from the picker stay single-topic
- **Dynamic lesson and question counts** — the module now scales to the size of the inserted code:
  - `< 800 chars` → 2 lessons × 3 questions (= 6 total)
  - `< 2500 chars` → 3 × 4 (= 12)
  - `< 6000 chars` → 4 × 5 (= 20)
  - `≥ 6000 chars` → 5 × 5 (= 25)
  Tiny dumps no longer get padded with trivia just to fill 25 questions

### Changed
- **Major lesson-prompt overhaul.** Hard quality rules now baked into the prompt: NEVER ask about variable names, comments, color values, casing, line counts, magic numbers, string literals, or filenames. ALWAYS ask about behavior, control flow, edge cases, side effects, and design intent. MC questions are now required to reference a meaningful code block (≥3 lines), not a single token
- Lesson prompt explicitly tells the model: "If the context truly doesn't support that many high-quality questions, return fewer (minimum 2). Better to have 3 sharp questions than 5 with trivia"
- Context prompt now instructs the model to skip imports, license headers, and pure constants when picking what to quiz on
- Token budget for lesson generation now scales with question count instead of a flat 1500
- Skeleton prompt now generates the requested lesson count instead of always emitting 5
- Module success toast shows actual lesson count instead of hardcoded "5"

### Fixed
- `MultipleChoiceQuestion`'s `lineRange` was previously dead — the `codeForMC` constant in `lesson.ts` was always `undefined` regardless of input. Now properly slices the referenced lines from the module context and renders them inline

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
