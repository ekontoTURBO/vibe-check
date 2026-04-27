# Vibe Check

> **Anti-vibe-coding mentor.** When AI writes code for you, Vibe Check turns it into a Duolingo-style quiz so you actually understand it.

Inspired by Duolingo's mastery loops and Brilliant's interactive learning, Vibe Check intercepts large AI-generated code insertions and turns them into structured, gated learning modules — complete with spaced repetition, three difficulty tracks, and an XP/streak system.

Built for **Google Antigravity, Cursor, Windsurf, VSCodium, VS Code**, and any other VS Code-compatible editor.

---

## Why?

You ship code an agent wrote. A week later, it breaks. You can't fix it because you never understood it. Vibe Check makes that impossible.

- An agent inserts >5 lines? **A 5-lesson module spawns automatically.**
- You read each line, then prove it with closed-question quizzes.
- Pass 4/5 to unlock the next lesson. Fail and you stay stuck — or skip with a streak hit.
- Questions you answered live in a spaced-repetition queue. Tomorrow Vibe Check asks you the trickiest ones again.

No fluff, no free-text gotchas, no LLM grading you on vibes. Closed questions, deterministic grading, pixel-art mascot judging your every wrong answer.

---

## Install

### Antigravity / Cursor / Windsurf / VSCodium

Open the Extensions panel, search **Vibe Check**, click Install.

### VS Code

Vibe Check is published to [Open VSX](https://open-vsx.org/), not Microsoft's Marketplace. To install in the official VS Code:

1. Download the latest `.vsix` from the [Open VSX page](https://open-vsx.org/extension/cognitra/vibe-check)
2. In VS Code: **Extensions panel → "..." menu → Install from VSIX...** → pick the file

Or via terminal:

```bash
code --install-extension vibe-check-X.Y.Z.vsix
```

---

## Quick start

1. **Open the sidebar.** Click the 🎓 mortarboard icon in the activity bar.
2. **Set your model provider.** Out of the box, Vibe Check tries to use GitHub Copilot (in VS Code) or Antigravity AI (in Antigravity). To use **Anthropic / OpenAI / Gemini / OpenRouter** directly:
   - **`Ctrl/Cmd+Shift+P`** → `Vibe Check: Set API Key…` → pick provider → paste key
   - **`Ctrl/Cmd+Shift+P`** → `Vibe Check: Switch Provider…` → pick the one you set
   - **`Ctrl/Cmd+Shift+P`** → `Vibe Check: Select Model…` → pick a model from the live list
3. **Trigger a quiz.** Either let an AI agent insert >5 lines into your editor (the Pulse Observer auto-fires), or:
   - Click **+ NEW** in the sidebar header → pick a topic
   - Right-click code → **Vibe Check: Quiz Me On Selection**
4. **Take the lesson.** Five questions. Pass with ≥80% to unlock the next.
5. **Daily review.** Click **↻ START DUE REVIEW** when the button shows due cards.

---

## Features

### Five lesson topics

| Topic | Source | Use it for |
|---|---|---|
| 📝 **Code** | Active editor selection or full file | Quizzing on code an agent just wrote |
| 🏗️ **Infrastructure** | `package.json`, `tsconfig.json`, eslint config, build configs, Dockerfile, CI workflows | Understanding the build/config layer |
| 🛠️ **Tools** | `package.json` deps & scripts | Knowing what each library does |
| 🧱 **Architecture** | Project directory tree | Understanding module boundaries |
| 🔐 **Security** | Active file (or project config) | Spotting injection vectors, validation gaps |

### Three difficulty tracks

- **Beginner** — recognition and recall (5 XP per correct answer)
- **Intermediate** — applied logic, predict outputs (10 XP)
- **Expert** — architecture, edge cases, trade-offs (20 XP)

Each track has its own modules, streak, XP, and review queue. Switch freely.

### Question types

- **Multiple choice** — one prompt, four plausible options, one correct
- **Code ordering** — shuffled lines you reorder via up/down arrows

### Smart editor integration

- **📍 SHOW** button on each code block opens the source file and highlights the referenced lines.
- **Backtick code references in prompts** are clickable. When the LLM writes a question like *"What does `Map.get(key)` return when…"*, click `Map.get(key)` and Vibe Check finds and highlights that exact text in your source.
- **Auto-glow** highlights the relevant code passively as you advance through a lesson.

### Optional personalized feedback

Got a question wrong? The default explanation is canonical and free. Click **? WHY** to ask the LLM for a personalized explanation that points at *your specific mistake*. Skip it and pay nothing.

### XP, streaks, daily ring

- Daily XP ring fills toward a 50-XP goal — work a little every day.
- Per-track streak counts consecutive days you answered ≥1 question correctly.
- Cross-device sync via VS Code Settings Sync — your XP follows you.

---

## Supported AI providers

| Provider | Set up | Best for |
|---|---|---|
| **GitHub Copilot** (`vscode.lm`) | Just sign into Copilot in VS Code | Free if you have Copilot |
| **Antigravity AI** | Auto-detected when running in Antigravity | Free in-host |
| **Anthropic Claude** | Get a key at [console.anthropic.com](https://console.anthropic.com/settings/keys) | Best educational explanations |
| **Google Gemini** | Get a key at [aistudio.google.com](https://aistudio.google.com/app/apikey) | Cheapest at scale |
| **OpenAI** | Get a key at [platform.openai.com](https://platform.openai.com/api-keys) | Most familiar |
| **OpenRouter** | Get a key at [openrouter.ai](https://openrouter.ai/keys) | One key, 100+ models |

API keys are stored encrypted in VS Code SecretStorage — they never sync to Settings Sync, never end up in `settings.json`. Set, clear, and rotate them via the command palette.

---

## Commands

| Command | Description |
|---|---|
| `Vibe Check: New Module...` | Open the topic picker to generate a fresh 5-lesson module |
| `Vibe Check: Quiz Me On Selection` | Generate a code module from your current editor selection |
| `Vibe Check: Start Due Review` | Run FSRS-due questions on the active track |
| `Vibe Check: Switch Track` | Change between beginner / intermediate / expert |
| `Vibe Check: Reset Progress` | Wipe all XP, streaks, modules, and FSRS cards |
| `Vibe Check: Switch Provider...` | Change which LLM backend Vibe Check uses |
| `Vibe Check: Select Model...` | Pick a specific model from the active provider's catalog |
| `Vibe Check: Set API Key...` | Save an API key for a direct provider (encrypted) |
| `Vibe Check: Clear API Key...` | Wipe a stored API key |

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `vibeCheck.autoQuiz` | `true` | Auto-fire a quiz when the Pulse Observer detects a large AI insertion |
| `vibeCheck.modelProvider` | `auto` | Which backend to use (`copilot`, `antigravity`, `anthropic`, `gemini`, `openai`, `openrouter`, or `auto`) |
| `vibeCheck.<provider>Model` | `""` | Per-provider model override — leave empty for sensible defaults |

Open the Settings UI and search "vibe check" to see them all with descriptions.

---

## Privacy

- API keys are stored in **VS Code SecretStorage** (encrypted, never synced).
- Code context sent to LLMs is bounded: 5 KB per file, 16 KB total per generation.
- All telemetry is **local-only**. Your XP, streaks, and modules live in `globalState`. Nothing is sent to a Vibe Check server because there is no Vibe Check server.

---

## Known limitations

- **Pulse heuristic is coarse.** Any insertion ≥200 chars or ≥5 lines triggers a module. Large pastes from non-AI sources also trigger.
- **Antigravity agent-artifact hook is speculative.** Probed defensively; falls back to text-change detection if the API surface changes.
- **Code-order questions need unique lines.** Duplicate lines get filtered during generation; rare but possible to lose a question to this.
- **Custom OpenAI-compatible endpoints aren't yet exposed in settings.** Want Ollama/LM Studio/local? See [DEVELOPMENT.md](DEVELOPMENT.md) for the one-line workaround.

---

## License

MIT — see [LICENSE](LICENSE).

---

**Combat vibe coding. Ship code you actually understand.**
