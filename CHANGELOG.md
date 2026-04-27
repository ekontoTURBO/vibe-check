# Changelog

All notable changes to Vibe Check are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
