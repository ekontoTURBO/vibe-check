# Changelog

All notable changes to Vibe Check are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [0.0.1]
- First public release
