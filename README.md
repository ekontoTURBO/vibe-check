# Vibe Check

> An anti-vibe-coding mentor for VS Code and Google Antigravity. When AI writes code for you, Vibe Check makes sure you actually understand it.

Inspired by Duolingo's mastery loops and Brilliant's interactive learning, Vibe Check turns AI-generated code into structured, gated learning modules — complete with spaced repetition, three difficulty tracks, and an XP/streak system.

---

## How it works

1. **Vibe Check watches your editor.** When an AI agent (or you) inserts a large chunk of code, the **Pulse Observer** flags it.
2. **A module is generated.** Five sequential lessons are created from the code (or any other topic — see below). Only the first lesson is unlocked.
3. **You take a lesson.** Five closed questions per lesson — multiple choice and code-ordering puzzles. No free-text gotchas.
4. **Pass to unlock.** Get **≥80% (4/5 correct)** to mark a lesson complete and unlock the next one.
5. **Spaced repetition kicks in.** Questions you answered are scheduled for review using the **FSRS** algorithm. Daily streaks and XP track your retention.

---

## Features

### Five lesson topics

| Topic | Source | Use it for |
|---|---|---|
| 📝 **Code** | Active editor selection or full file | Quizzing on code an agent just wrote |
| 🏗️ **Infrastructure** | `package.json`, `tsconfig.json`, `eslint.config`, build configs, Dockerfile, CI workflows | Understanding the build/config layer |
| 🛠️ **Tools** | `package.json` deps & scripts | Knowing what each library does and why |
| 🧱 **Architecture** | Project directory tree | Understanding module boundaries |
| 🔐 **Security** | Active file (or project config) | Spotting injection vectors, validation gaps |

### Three difficulty tracks

Pick at the top of the sidebar:
- **Beginner** — recognition and recall (5 XP per correct answer)
- **Intermediate** — applied logic, predict outputs (10 XP)
- **Expert** — architecture, edge cases, trade-offs (20 XP)

Each track has its own streak, XP, modules, and review queue. Switch freely.

### Closed-question types

- **Multiple choice** — one prompt, four plausible options, one correct
- **Code ordering** — shuffled lines you reorder by tapping (great for control flow, async/await, lifecycle)

### Personalized wrong-answer feedback

When you answer wrong, the LLM analyzes *your specific choice* and explains why it's incorrect — not a canned definition. Then you get **↻ Try Again** or **Skip**.

### Editor integration

- **📍 Show in editor** button on each question opens the source file and glows the referenced lines
- **Auto-glow** highlights the relevant code passively as you advance through a lesson (won't steal focus)
- Cross-device sync via `globalState.setKeysForSync` — your XP and progress follow you

### Module path UI

Lessons render as a vertical Duolingo-style path:
- 🔒 **Locked** — earn it
- ⭐ **Available** — pulsing gold ring
- ✓ **Completed** — green node, click to retake

Connector lines turn green as you advance.

---

## Requirements

### To run

- **VS Code 1.116+** or **Google Antigravity**
- An LLM:
  - **VS Code**: GitHub Copilot subscription (uses `vscode.lm` chat API; defaults to **GPT-4o**, falls back to any Copilot model)
  - **Antigravity**: built-in `antigravity.ai` API (uses **gemini-3-flash**)
- A workspace folder open (most topics need one; the Code topic only needs an open file)

### To develop

- Node.js 22+
- `npm install` in the project root
- Press **F5** to launch the Extension Development Host (configured to open this project as the test workspace)

---

## Commands

| Command | Description |
|---|---|
| `Vibe Check: New Module...` | Pick a topic and generate a fresh 5-lesson module |
| `Vibe Check: Quiz Me On Selection` | Generate a code module from your current editor selection |
| `Vibe Check: Start Due Review` | Run FSRS-due questions on the active track |
| `Vibe Check: Switch Track` | Change between beginner/intermediate/expert |
| `Vibe Check: Reset Progress` | Wipe all XP, streaks, modules, and FSRS cards |

The **mortarboard 🎓 icon** in the activity bar opens the sidebar.

---

## Architecture

```
src/
├── extension.ts            Activation + command wiring + pulse handler
├── EnvironmentDetector.ts  VS Code vs Antigravity detection
├── LLMService.ts           Unified wrapper over vscode.lm + antigravity.ai
├── PulseObserver.ts        Watches for large AI-style insertions; hooks Antigravity AgentArtifact events
├── ContextGatherer.ts      Topic-specific source assembly (code, package.json, dir tree, etc.)
├── TeacherProvider.ts      Two-stage LLM prompts: module skeleton → on-demand lesson questions
├── FSRSManager.ts          ts-fsrs scheduler + per-track XP, streaks, lesson lock/unlock
├── SidebarView.ts          Webview UI: track tabs, module path, MC + code-order rendering
└── types.ts                Shared types (Module, ModuleLesson, Question union, messages)
```

**Key decisions:**
- **Lazy lesson generation** — module skeletons cost ~500 tokens, full question sets generate only when you click into a lesson. No wasted LLM calls on lessons you'll never reach.
- **Closed questions only** — answers grade deterministically (no LLM grading call per submit), making the loop fast and cheap.
- **Pass threshold 80%** — Duolingo-style mastery gate. Below that, the lesson stays available, you retry the same questions.
- **First-attempt grading happens on finalize** — clicking "Try Again" doesn't pollute the FSRS record. Only "Next" (after correct) or "Skip" (after wrong) writes to the spaced repetition store.

---

## Storage

All progress lives in `extensionContext.globalState` (synced across devices via VS Code Settings Sync):

- `vibeCheck.modules.v3` — your modules and their lesson states
- `vibeCheck.cards.v3` — FSRS card data (due dates, stability, etc.)
- `vibeCheck.progress.v3` — XP, streaks, active track per track

Reset with `Vibe Check: Reset Progress`.

---

## Configuration

The default model for VS Code is **GPT-4o** via Copilot. To change it (e.g. to Claude Sonnet via Copilot, or remove the family filter entirely), edit [`src/LLMService.ts`](src/LLMService.ts):

```ts
const models = await lm.selectChatModels({
  vendor: 'copilot',
  family: 'gpt-4o',  // ← change me
});
```

For Antigravity, the model is `gemini-3-flash` — change the string in `LLMService.callAntigravity`.

---

## Known limitations

- **Pulse heuristic is coarse**: any insertion ≥200 chars or ≥5 lines triggers a module (debounced 350ms, with a 30-second cooldown between modules). Large pastes from outside an AI agent will also trigger.
- **Antigravity hooks are speculative**: `antigravity.agent.onArtifact` is probed defensively. If the API surface changes, the agent-plan integration is a graceful no-op.
- **`code-order` requires unique lines**: questions with duplicate lines are filtered during generation. The LLM is instructed to keep them unique.
- **No retry-yet-still-counted-correct nuance**: get it right on retry → full XP. Skip → 0 XP. Pure first-try-only scoring isn't tracked separately.

---

## Development

```bash
npm install
npm run watch       # esbuild + tsc in parallel watch mode
# Press F5 to launch Extension Development Host
```

Other scripts:
- `npm run compile` — one-shot bundle + type-check + lint
- `npm run package` — production bundle
- `npm run lint` — eslint
- `npm run check-types` — tsc --noEmit

---

## Tech stack

- **TypeScript 5.9** strict mode
- **esbuild** for bundling (~90 KB output)
- **[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.3** for spaced repetition (Free Spaced Repetition Scheduler)
- **`vscode.lm`** chat API + Webview API
- No runtime dependencies beyond `ts-fsrs` — everything else is dev tooling

---

## License

MIT

---

**Combat vibe coding. Ship code you actually understand.**
