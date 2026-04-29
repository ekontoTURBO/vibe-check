# Vibe Check — Developer Guide

Personal reference for running, building, debugging, publishing, and reasoning about the codebase.

---

## 1 · First-time setup

Once-per-clone:

```bash
cd c:/Users/erykc/Desktop/vibe-check
npm install                  # installs dev tooling: esbuild, tsc, eslint, mocha
node esbuild.js              # builds dist/extension.js + media/sidebar.js (one-shot)
```

That's it. Everything else is iteration.

---

## 2 · Running the extension (F5)

VS Code launch configs live in [.vscode/launch.json](.vscode/launch.json):

| Config | What it does |
|---|---|
| **Run Extension (no build)** | Skips the build, expects `dist/` and `media/sidebar.js` to already exist. **Don't pick this on a fresh clone — it crashes with `Cannot find module dist/extension.js`.** |
| **Run Extension** | Runs the watch task first (esbuild + tsc in parallel), then launches. Use this on first F5 of a session. |

**Recommended workflow:**

1. Open a terminal and run `npm run watch` once. Leave it running. It rebuilds both bundles on every save.
2. Press **F5**, pick **Run Extension (no build)**. Launches instantly.
3. After editing code, hit **`Ctrl+R`** in the Extension Development Host window to reload — the watch task already rebuilt for you.
4. After editing `package.json` (commands, settings, manifest), hit **`Ctrl+R`** to pick up manifest changes too.

If F5 errors with "Cannot find module dist/extension.js": you skipped step 1. Run `node esbuild.js` once and try again.

---

## 3 · Build commands

All in [package.json](package.json) `scripts`:

| Command | What it runs | Use when |
|---|---|---|
| `npm run watch` | esbuild + tsc in parallel watch mode | While developing |
| `node esbuild.js` | One-shot dev build (sourcemaps included) | Before F5 if no watch is running |
| `node esbuild.js --production` | One-shot production build (minified, no maps) | Before manual `vsce package` |
| `npm run package` | `check-types` + `lint` + production build | Sanity check before publishing |
| `npm run check-types` | `tsc --noEmit` | Type errors only |
| `npm run lint` | eslint | Style/correctness only |
| `node scripts/generate-icon.js` | Regenerates `media/icon.png` | If you tweak the icon script |

`vsce package` automatically runs `npm run package` via the `vscode:prepublish` hook before bundling the VSIX.

---

## 4 · Architecture

```
src/
├── extension.ts                    Activation, command wiring, pulse handler
├── EnvironmentDetector.ts          VS Code vs Antigravity detection (cached)
├── LLMService.ts                   Thin facade over ProviderRegistry
├── TeacherProvider.ts              LLM prompts: skeleton → on-demand questions
├── FSRSManager.ts                  ts-fsrs scheduler + shared XP/streak/freeze + lesson locks
├── PulseObserver.ts                Watches text changes for AI-insertion patterns
├── ContextGatherer.ts              Topic-specific source assembly (code/configs/tree)
├── SidebarView.ts                  Webview host: HTML shell, CSP, message router
├── types.ts                        Shared types (Module, Question, ProgressState)
│
├── providers/
│   ├── types.ts                    LLMProvider interface + ProviderId enum
│   ├── secrets.ts                  SecretStorage wrapper + plain-settings migration
│   ├── registry.ts                 Resolves active provider, getModelFor/setModelFor
│   ├── commands.ts                 Set/Clear API Key, Switch Provider, Select Model
│   ├── copilot.ts                  vscode.lm wrapper
│   ├── antigravity.ts              globalThis.antigravity.ai wrapper
│   ├── anthropic.ts                POST /v1/messages, GET /v1/models
│   ├── gemini.ts                   POST {model}:generateContent, GET /v1beta/models
│   └── openaiCompatible.ts         Shared impl for OpenAI + OpenRouter
│
└── webview/                        Bundled separately into media/sidebar.js
    ├── index.ts                    Entry: subscribes to store, drives render
    ├── store.ts                    Single state, dispatch, rAF batching
    ├── render.ts                   Top-level screen swap
    ├── api.ts                      acquireVsCodeApi() wrapper
    ├── dom.ts                      h(tag, attrs, children) helper
    ├── pixelArt.ts                 Glitch + icons (verbatim char grids)
    ├── promptText.ts               Backtick-aware prompt renderer (code refs)
    ├── types.ts                    View-specific types + message protocol
    └── components/
        ├── header.ts               Track tabs, daily ring, XP/streak/rank
        ├── home.ts                 Module list + due review CTA
        ├── path.ts                 Duolingo-style lesson path
        ├── lesson.ts               MC + code-order question rendering
        ├── feedback.ts             Correct/wrong strip with optional ? WHY
        ├── complete.ts             Confetti, win/sad mascot, stats
        ├── picker.ts               New-module topic picker
        └── pulse.ts                In-sidebar pulse banner

media/
├── sidebar.css                     Hand-written pixel design system
├── sidebar.js                      Built artifact (gitignored)
├── icon.png                        Generated by scripts/generate-icon.js
└── fonts/
    ├── PressStart2P-Regular.woff2
    └── JetBrainsMono-Regular.woff2
```

### How extension and webview communicate

The webview runs in a sandboxed iframe, no direct access to Node or `vscode.*`. They talk via postMessage:

**Webview → host** ([src/webview/types.ts](src/webview/types.ts) `ClientMessage`):
- `ready` (initial handshake)
- `setTrack` / `openModule` / `closeModule` / `openPicker` / `closePicker`
- `newModule` (topic) / `startLesson` / `startReview`
- `submitAnswer` (with correctness flag, informational)
- `requestWrongFeedback` (only when user clicks ? WHY)
- `tryAgain` / `finalizeQuestion` (correct/wrong)
- `revealLines` / `revealSnippet` — for the editor highlight features
- `dismissPulse` / `dismissError` / `completeAcknowledged` / `exitLesson`

**Host → webview**:
- `state` — full hydrate (after every host mutation)
- `wrongFeedback` — async LLM response when user asked ? WHY
- `error` — error toast

The webview owns view state (current selection, feedback strip state). The host owns domain state (FSRS cards, modules, progress) and re-pushes the full snapshot whenever it mutates.

### Provider system

Every backend implements [providers/types.ts](src/providers/types.ts) `LLMProvider`:

```ts
interface LLMProvider {
  id: ProviderId;
  isAvailable(): Promise<boolean>;
  complete(req: LLMRequest, opts?: CompleteOptions): Promise<string>;
  listModels?(): Promise<string[]>;
  curatedModels(): string[];
}
```

[ProviderRegistry](src/providers/registry.ts) instantiates all six and routes based on `vibeCheck.modelProvider`:
- Explicit pick → use that provider, fall back to Antigravity/Copilot if missing key
- `auto` → try Antigravity, then Copilot, then any direct provider with a saved key

API keys live in [providers/secrets.ts](src/providers/secrets.ts) → `vscode.SecretStorage` (encrypted, doesn't sync). One-time migration from old plain-text settings runs on activate.

### Adding a new provider

To add e.g. a Mistral direct backend:

1. Create `src/providers/mistral.ts`. Implement `LLMProvider`. Use `secrets.get('mistral')` to read the key.
2. Add `'mistral'` to `ProviderId` and `ALL_PROVIDERS` in [providers/types.ts](src/providers/types.ts). Add label and (optional) key URL.
3. Register it in [providers/registry.ts](src/providers/registry.ts) constructor.
4. Add `vibeCheck.mistralModel` to [package.json](package.json) under `Vibe Check: Models` section.

That's it. The Switch Provider / Set API Key / Select Model commands automatically pick it up.

### Adding a custom OpenAI-compatible endpoint (Ollama, LM Studio, etc.)

The `OpenAICompatibleProvider` in [providers/openaiCompatible.ts](src/providers/openaiCompatible.ts) is parameterized by `baseUrl`. To wire up a local Ollama:

```ts
// In registry.ts
const ollama = new OpenAICompatibleProvider(secrets, {
  id: 'ollama',  // add to ProviderId enum
  label: 'Ollama (local)',
  defaultModel: 'llama3.2',
  baseUrl: 'http://localhost:11434/v1',
  getKeyUrl: undefined,
  curated: ['llama3.2', 'qwen2.5-coder', 'deepseek-coder-v2'],
});
```

Future TODO: expose `baseUrl` as a setting so users can do this without code changes.

### Token economics

Each module's lifecycle:

| Phase | Tokens (approx) | When |
|---|---|---|
| Skeleton (5 lesson titles + objectives) | ~2,600 in / 700 out | Once when module spawns |
| Lesson questions (5 per lesson) | ~2,100 in / 1,500 out | Once per lesson, on click (lazy) |
| Wrong-answer personalized feedback | ~250 in / 250 out | Only when user clicks ? WHY |

Full module typical (no ? WHY clicks): ~21,000 tokens. With max ? WHY clicks: ~22,800.

Knobs in [TeacherProvider.ts](src/TeacherProvider.ts) and [ContextGatherer.ts](src/ContextGatherer.ts):
- `MAX_FILE_BYTES` — current 5,000. Trim more if costs are spiky.
- `maxTokens` for lesson — current 1,500. Each `5 questions × ~300 tokens` averages well within.

### Storage keys

Per-project (`workspaceState`, never synced):
- `vibeCheck.modules.v3` — modules with their lessons + lazily-generated questions
- `vibeCheck.cards.v3` — FSRS card state per question (due dates, stability, rep history)

User-level (`globalState`, opt-in Settings Sync):
- `vibeCheck.progress.v3` — XP, streak, daily ring, freezes, totals (shared across tracks since v0.1.1)
- `vibeCheck.firstRunActivated.v1`, `vibeCheck.welcomeShown.v2` — one-shot flags
- `vibeCheck.telemetry.consent.v1` — telemetry decision
- `vibeCheck.telemetry.queue.v1` — local mirror of pending telemetry events

Wipe both layers with `Vibe Check: Reset Progress`.

### Pulse Observer

[PulseObserver.ts](src/PulseObserver.ts) listens to `vscode.workspace.onDidChangeTextDocument`. Heuristic: ≥200 chars OR ≥5 lines = "looks like an AI insert". Debounce 350ms, 30s cooldown between modules.

In Antigravity, also probes `globalThis.antigravity.agent.onArtifact` defensively. If the API exists, agent plans become a richer pulse signal. If not, falls back to text-change detection only.

---

## 5 · Publishing to Open VSX

You read the comprehensive guide once. Here's the recap for future releases.

### One-time setup
1. GitHub repo created and pushed
2. Eclipse Foundation account at [open-vsx.org](https://open-vsx.org/) via GitHub login
3. ECA signed at [accounts.eclipse.org/user/eca](https://accounts.eclipse.org/user/eca)
4. Namespace created at open-vsx.org/user-settings/namespaces
5. Access token generated at open-vsx.org/user-settings/tokens — **save it in your password manager**
6. `npm install -g @vscode/vsce ovsx`
7. `package.json` `publisher` field matches the namespace exactly

### Per-release flow
```bash
# 1. Bump version in package.json (or use vsce package patch / minor / major)
#    e.g. "version": "0.0.2"

# 2. Build & verify
npm run check-types && npm run lint && node esbuild.js

# 3. Package locally
vsce package
# produces vibe-check-0.0.2.vsix at repo root

# 4. (Optional but strongly recommended) sideload-test in clean profile
code --profile=vibecheck-test --install-extension vibe-check-0.0.2.vsix
# walk through one full lesson loop end-to-end

# 5. Publish
ovsx publish vibe-check-0.0.2.vsix -p <your-token>

# 6. Tag the release in git
git tag v0.0.2
git push --tags

# 7. Verify on https://open-vsx.org/extension/<your-namespace>/vibe-check
```

### If `ovsx publish` errors

| Error | Fix |
|---|---|
| `Namespace not found` | `package.json` `publisher` field doesn't match your Open VSX namespace exactly (case-sensitive) |
| `Version already published` | Bump `version` in `package.json` — Open VSX never lets you overwrite a version |
| `Could not validate license` | Check `LICENSE` file exists at repo root, manifest `license` field matches |
| `Missing repository field` | Add `repository.url` to `package.json` |
| `User is missing the publisher rights for this namespace` | Token doesn't belong to a member of the namespace, or namespace not yet created |

### Adding VS Code Marketplace later

When you're ready for Microsoft Marketplace too:

1. Take the Azure free trial: [azure.microsoft.com/free](https://azure.microsoft.com/free) — credit card required for verification, no charge
2. Create Azure DevOps org at [aex.dev.azure.com/me](https://aex.dev.azure.com/me) — should now allow without subscription error
3. Generate PAT (top-right avatar → Personal access tokens → New, scopes: Marketplace → Manage)
4. Create publisher at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) — same email as Azure DevOps, same name as Open VSX namespace if possible (otherwise add an alias)
5. `vsce login <publisher-id>` then `vsce publish`

The same VSIX works for both.

---

## 6 · Common gotchas

**`acquireVsCodeApi is not defined`** in webview console — only happens if you load `media/sidebar.js` outside a webview context. Inside the actual extension, it's there.

**Settings UI doesn't show your changes** — `package.json` changes need a window reload. `Ctrl+R` in the Extension Development Host.

**Theme not switching** — sidebar reads `body[data-vscode-theme-kind]` set by VS Code. If it's not flipping, you're in a host that doesn't set that attribute. Brand colors stay constant; only chrome adapts.

**Pulse not firing on edits** — check the cooldown (30s between modules) and the threshold (≥40 chars trimmed inside the listener). If `vibeCheck.autoQuiz` is `false`, you'll see a confirmation toast instead of immediate generation.

**`vsce package` warns about missing fields** — usually one of: `repository.url`, `bugs.url`, `license`, `icon`. All should be filled in [package.json](package.json) at this point. If a warning appears, follow the message — it's specific.

**Production bundle smaller than dev?** — yes, by ~50%. Production minifies and strips sourcemaps. Both work; production is what ships.

**`code --install-extension` says "extension not signed"** — VS Code 1.96+ enforces VSIX signing for some operations. Workaround: install via the UI ("Install from VSIX..." menu) instead, or set `extensions.allowUnsigned` to true in test profile.

---

## 7 · Tech stack

- **TypeScript 5.9 strict mode**
- **esbuild** for bundling — dual target (extension CJS + webview IIFE) in [esbuild.js](esbuild.js)
- **`vscode.lm`** chat API + Webview API + SecretStorage
- **[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.3** for spaced repetition (Free Spaced Repetition Scheduler)
- **No runtime dependencies beyond `ts-fsrs`** — Press Start 2P + JetBrains Mono ship as woff2, all icons are DOM cells, no React
- **Pure DOM webview** — single state object, dispatch, rAF batched render, ~25 KB minified

### Key design decisions

- **Webview is vanilla TS + DOM, no React.** Saves 60+ KB and a hydration tax. Pixel art is "honest" — every cell is an absolutely-positioned DIV, not an SVG.
- **Closed questions only.** Grading is deterministic (no LLM call per submit), making the loop fast and cheap. The LLM only earns its keep when (a) generating questions and (b) explaining personalized wrongness.
- **Lazy lesson generation.** Module skeleton is ~700 tokens; full question sets generate only when the user clicks into a lesson. No wasted LLM calls on lessons you'll never reach.
- **Pass threshold 80%.** Duolingo-style mastery gate.
- **First-attempt grading happens on finalize.** Clicking "Try Again" doesn't pollute FSRS — only "Next" (after correct) or "Skip" writes.
- **API keys never in `settings.json`.** SecretStorage is encrypted and doesn't sync. The Settings Sync angle here matters: a Gmail-using user signing into VS Code on a public computer doesn't accidentally leak their `sk-ant-…` key.

---

## 8 · TODOs / future work

- **Custom OpenAI-compatible endpoint setting** — expose `baseUrl` so Ollama/LM Studio Just Work without code edits
- **Streaming responses** — currently we buffer full responses; lessons would feel snappier with progressive rendering of the question stream
- **Retry/backoff** — 429s currently throw; small `Retry-After`-aware retry would smooth the UX
- **Open VSX verified namespace** — eventually submit a PR to the [openvsx.org/foundation-publishing](https://github.com/EclipseFdn/openvsx-publishing) catalog
- **Real screenshots in README + Open VSX listing**
- **Write actual tests** — `src/test/extension.test.ts` is still the boilerplate sample
- **Cursor-window context for code topic** — when the file is large, prefer text near the cursor rather than truncating from byte 0

Each is a 30–90 minute job. None are blockers for v0.0.1.

---

## 9 · The mental model

You're building a **closed-loop learning system on top of an open-loop coding workflow**. The agent generates code (open loop, no understanding required). Vibe Check forces a closing checkpoint: every large insertion triggers a small synchronous comprehension test. Spaced repetition makes the test recur until the knowledge actually sticks.

Everything else is plumbing.
