"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/webview/store.ts
  var EMPTY_STATE = {
    screen: { kind: "home" },
    track: "beginner",
    progress: {
      xp: 0,
      streak: 0,
      dailyXp: 0,
      dailyGoal: 50,
      rank: null,
      totalAnswered: 0,
      totalCorrect: 0
    },
    modules: [],
    activeModule: null,
    activeLesson: null,
    dueCount: 0,
    environment: "vscode",
    isGenerating: false,
    capabilities: {
      hasActiveEditor: false,
      hasWorkspaceFolder: false,
      hasPackageJson: false
    },
    pulse: null,
    error: null,
    feedback: null
  };
  var Store = class {
    constructor() {
      __publicField(this, "state", EMPTY_STATE);
      __publicField(this, "listeners", /* @__PURE__ */ new Set());
      __publicField(this, "rafId", 0);
    }
    getState() {
      return this.state;
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    /** Replace the host-driven slice. Preserves view-only fields like `feedback`. */
    hydrate(next) {
      const prevFeedback = this.state.feedback;
      const sameLesson = this.state.activeLesson?.lessonId === next.activeLesson?.lessonId && this.state.activeLesson?.currentIndex === next.activeLesson?.currentIndex;
      this.state = {
        ...next,
        feedback: sameLesson ? prevFeedback : null
      };
      this.scheduleRender();
    }
    patch(partial) {
      this.state = { ...this.state, ...partial };
      this.scheduleRender();
    }
    setScreen(screen) {
      this.patch({ screen });
    }
    setTrackOptimistic(track) {
      this.patch({ track });
    }
    setError(message) {
      this.patch({ error: message });
    }
    setPulse(info) {
      this.patch({ pulse: info });
    }
    setGenerating(isGenerating, topic) {
      this.patch({ isGenerating, generatingTopic: topic });
    }
    setFeedback(feedback) {
      this.patch({ feedback });
    }
    updateFeedback(updater) {
      if (!this.state.feedback) {
        return;
      }
      this.patch({ feedback: updater(this.state.feedback) });
    }
    currentQuestion() {
      const lesson = this.state.activeLesson;
      if (!lesson) {
        return null;
      }
      return lesson.questions[lesson.currentIndex] ?? null;
    }
    scheduleRender() {
      if (this.rafId) {
        return;
      }
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        for (const l of this.listeners) {
          try {
            l(this.state);
          } catch (err) {
            console.error("[VibeCheck webview] listener error", err);
          }
        }
      });
    }
  };
  var store = new Store();

  // src/webview/dom.ts
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      applyAttrs(el, attrs);
    }
    appendChildren(el, children);
    return el;
  }
  function applyAttrs(el, attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === void 0 || value === null || value === false) {
        continue;
      }
      if (key === "className") {
        el.className = String(value);
      } else if (key === "style") {
        if (typeof value === "string") {
          el.setAttribute("style", value);
        } else {
          Object.assign(el.style, value);
        }
      } else if (key === "dataset") {
        for (const [dk, dv] of Object.entries(value)) {
          el.dataset[dk] = dv;
        }
      } else if (key === "on") {
        for (const [evt, handler] of Object.entries(value)) {
          el.addEventListener(evt, handler);
        }
      } else if (key.startsWith("aria-") || key.startsWith("data-")) {
        el.setAttribute(key, String(value));
      } else if (key in el) {
        el[key] = value;
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  function appendChildren(el, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false || child === true) {
        continue;
      }
      if (Array.isArray(child)) {
        appendChildren(el, child);
      } else if (child instanceof Node) {
        el.appendChild(child);
      } else {
        el.appendChild(document.createTextNode(String(child)));
      }
    }
  }
  function clear(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  // src/webview/pixelArt.ts
  function pixelGrid(art, palette, opts = {}) {
    const scale = opts.scale ?? 2;
    const rows = art.trim().split("\n").map((r) => r.trim());
    const cols = rows[0]?.length ?? 0;
    const root2 = document.createElement("div");
    root2.className = `pixelated${opts.className ? " " + opts.className : ""}`;
    root2.style.position = "relative";
    root2.style.display = "inline-block";
    root2.style.width = `${cols * scale}px`;
    root2.style.height = `${rows.length * scale}px`;
    if (opts.style) {
      Object.assign(root2.style, opts.style);
    }
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < cols; x++) {
        const ch = rows[y][x];
        const color = palette[ch];
        if (!color || color === "transparent") {
          continue;
        }
        const cell = document.createElement("div");
        cell.style.position = "absolute";
        cell.style.left = `${x * scale}px`;
        cell.style.top = `${y * scale}px`;
        cell.style.width = `${scale}px`;
        cell.style.height = `${scale}px`;
        cell.style.background = color;
        root2.appendChild(cell);
      }
    }
    return root2;
  }
  var GLITCH_PALETTE = {
    ".": "transparent",
    "0": "#1a1a1a",
    "1": "#ff77b8",
    "2": "#c84d8e",
    "3": "#ffffff",
    "4": "#1a1a1a",
    "5": "#ffd23f",
    "6": "#4ec9ff",
    "7": "#7a2851",
    "8": "#6fdc7a",
    "9": "#ff5a6a",
    "a": "#ffb3d4"
  };
  var GLITCH_IDLE = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163400340312..
.0163443344312..
.0163400340312..
.0163333333312..
.01666666666127.
.0111111111112..
.0111155551112..
.02222222222227.
..7777777777777.
`;
  var GLITCH_HAPPY = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163008008312..
.0163008008312..
.0163008008312..
.0163333333312..
.01666688866127.
.0111188888112..
.0111155551112..
.02222222222227.
..7777777777777.
`;
  var GLITCH_SAD = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163443344312..
.0163400440312..
.0163400440312..
.0163333333312..
.01666666666127.
.0111199999112..
.0111159995112..
.02222222222227.
..7777777777777.
`;
  var GLITCH_SURPRISE = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163040040312..
.0163040040312..
.0163040040312..
.0163333333312..
.01666666666127.
.0111199911112..
.0111199911112..
.02222222222227.
..7777777777777.
`;
  var GLITCH_THINK = `
................
................
.000000000000.55
.0aaaaaaaaaa0.5.
.0111111111102.5
.0166666666612.7
.0163333333312..
.0163004400312..
.0163004400312..
.0163400040312..
.0163333333312..
.01666666666127.
.0111111551112..
.0111155555112..
.02222222222227.
..7777777777777.
`;
  var GLITCH_WIN = `
................
.....55....55...
....5..5..5..5..
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163338833312..
.0163088880312..
.0163088880312..
.0163338833312..
.01666666666127.
.0111188888112..
.0111155551112..
.02222222222227.
..7777777777777.
`;
  var MOODS = {
    idle: GLITCH_IDLE,
    happy: GLITCH_HAPPY,
    sad: GLITCH_SAD,
    surprise: GLITCH_SURPRISE,
    think: GLITCH_THINK,
    win: GLITCH_WIN
  };
  function glitch(mood = "idle", scale = 2, opts = {}) {
    const wrap = h("div", {
      className: opts.animate !== false ? "anim-blink" : "",
      style: { display: "inline-block" }
    });
    wrap.appendChild(pixelGrid(MOODS[mood], GLITCH_PALETTE, { scale }));
    return wrap;
  }
  var ICON_FLAME = `
....1.....
...121....
..12231...
.1223321..
.1223321..
12233321.0
12333321.0
13333331.0
13333331.0
.1333331..
.1333331..
..11331...
`;
  var ICON_STAR = `
....11....
....11....
...1331...
.1133311..
1113333111
.1113311..
..11331...
.113.311..
.11...11..
`;
  var ICON_LOCK = `
..0000....
.001100...
.010010...
.010010...
00000000..
01111110..
01100110..
01101110..
01111110..
00000000..
`;
  var ICON_CHECK = `
........11
.......110
......110.
00...110..
.00.110...
..0010....
...000....
....0.....
`;
  var ICON_HEART = `
..00..00..
.0330033..
.3333333..
.3333333..
.3333333..
..33333...
...333....
....3.....
`;
  var ICON_TROPHY = `
2.222222.2
22222222.2
.022220.22
.022220.2.
..0220....
..0220....
..0220....
.022220...
.222222...
`;
  var ICON_CODE = `
.0......0.
0........0
0..00.00.0
0.0.0..0.0
0.0.0..0.0
0..00.00.0
0........0
.0......0.
`;
  var ICON_CAP = `
....0.....
...000....
..00000...
.0000000..
0000000000
.0000000..
.0..0..0..
....0.....
....00....
`;
  var ICON_REGISTRY = {
    flame: {
      art: ICON_FLAME,
      build: () => ({
        ".": "transparent",
        "0": "#1a1a1a",
        "1": "#ff7a3d",
        "2": "#ffd23f",
        "3": "#ff5a6a",
        "4": "#ffffff"
      })
    },
    star: {
      art: ICON_STAR,
      build: () => ({
        ".": "transparent",
        "0": "#1a1a1a",
        "1": "#ffd23f",
        "2": "#c89a1a",
        "3": "#ffffff"
      })
    },
    lock: {
      art: ICON_LOCK,
      build: (color) => ({ ".": "transparent", "0": color, "1": "#ffd23f" })
    },
    check: {
      art: ICON_CHECK,
      build: (color) => ({ ".": "transparent", "0": color, "1": "#ffffff" })
    },
    heart: {
      art: ICON_HEART,
      build: () => ({ ".": "transparent", "0": "#1a1a1a", "3": "#ff5a6a" })
    },
    trophy: {
      art: ICON_TROPHY,
      build: () => ({ ".": "transparent", "0": "#1a1a1a", "2": "#ffd23f" })
    },
    code: {
      art: ICON_CODE,
      build: (color) => ({ ".": "transparent", "0": color })
    },
    cap: {
      art: ICON_CAP,
      build: (color) => ({ ".": "transparent", "0": color })
    }
  };
  function pixelIcon(kind, opts = {}) {
    const def = ICON_REGISTRY[kind] ?? ICON_REGISTRY.star;
    return pixelGrid(def.art, def.build(opts.color ?? "currentColor"), {
      scale: opts.scale ?? 2,
      className: opts.className
    });
  }
  function topicIcon(topic) {
    switch (topic) {
      case "code":
        return "code";
      case "security":
        return "lock";
      case "tools":
        return "star";
      case "infrastructure":
      case "architecture":
      default:
        return "cap";
    }
  }

  // src/webview/api.ts
  var cached = null;
  function getApi() {
    if (cached) {
      return cached;
    }
    if (typeof acquireVsCodeApi === "function") {
      cached = acquireVsCodeApi();
      return cached;
    }
    return null;
  }
  function send(msg) {
    const api = getApi();
    if (!api) {
      console.warn("[VibeCheck webview] no vscode api", msg);
      return;
    }
    api.postMessage(msg);
  }

  // src/webview/components/header.ts
  var TRACKS = [
    { id: "beginner", label: "BEGIN" },
    { id: "intermediate", label: "INTER" },
    { id: "expert", label: "EXPRT" }
  ];
  var TRACK_ACCENT = {
    beginner: "var(--vc-cyan)",
    intermediate: "var(--vc-pink)",
    expert: "var(--vc-violet)"
  };
  var TRACK_BG = {
    beginner: "rgba(78,201,255,0.12)",
    intermediate: "rgba(255,119,184,0.12)",
    expert: "rgba(177,140,255,0.14)"
  };
  var TRACK_LABEL = {
    beginner: "BEGINNER",
    intermediate: "INTERMED",
    expert: "EXPERT"
  };
  function trackBadge(track) {
    return h(
      "span",
      {
        className: "chip",
        style: {
          background: TRACK_BG[track],
          color: TRACK_ACCENT[track],
          fontSize: "8px"
        }
      },
      `\u25C6 ${TRACK_LABEL[track]}`
    );
  }
  function dailyRing(value, goal) {
    const pct = Math.max(0, Math.min(1, goal > 0 ? value / goal : 0));
    const deg = pct * 360;
    const pie = h("div", {
      className: "vc-ring__pie",
      style: {
        background: `conic-gradient(var(--vc-gold) 0deg ${deg}deg, var(--vc-bg-4) ${deg}deg 360deg)`
      }
    });
    const inner = h(
      "div",
      { className: "vc-ring__inner" },
      h("span", { className: "vc-ring__value" }, String(Math.min(value, goal))),
      h("span", { className: "vc-ring__goal" }, `/${goal}`)
    );
    return h("div", { className: "vc-ring" }, pie, inner);
  }
  function statRow(icon, value, label, color) {
    return h(
      "div",
      { className: "vc-stat-row" },
      icon,
      h(
        "div",
        { className: "col" },
        h("span", { className: "vc-stat-row__value", style: { color } }, String(value)),
        h("span", { className: "vc-stat-row__label" }, label)
      )
    );
  }
  function renderHeader(state) {
    const { progress, track } = state;
    const brandRow = h(
      "div",
      { className: "vc-header__brand" },
      glitch("idle", 2),
      h(
        "div",
        { className: "col grow" },
        h("span", { className: "vc-header__title" }, "VIBE CHECK"),
        h("span", { className: "vc-header__tagline" }, "LEVEL UP YOUR CODE")
      ),
      trackBadge(track)
    );
    const tabs = h(
      "div",
      { className: "vc-header__tracks" },
      TRACKS.map(
        (t) => h(
          "button",
          {
            className: `vc-track-btn${t.id === track ? " vc-track-btn--active" : ""}`,
            on: {
              click: () => send({ type: "setTrack", track: t.id })
            }
          },
          t.label
        )
      )
    );
    const flameIcon = h(
      "div",
      { className: "anim-flame", style: { color: "var(--vc-flame)" } },
      pixelIcon("flame", { scale: 2 })
    );
    const stats = h(
      "div",
      { className: "vc-stats" },
      dailyRing(progress.dailyXp, progress.dailyGoal),
      h(
        "div",
        { className: "vc-stats__col" },
        statRow(pixelIcon("star", { scale: 2 }), progress.xp, "XP", "var(--vc-gold)"),
        statRow(flameIcon, progress.streak, "DAY STREAK", "var(--vc-flame)"),
        progress.rank ? statRow(pixelIcon("trophy", { scale: 2 }), progress.rank, "RANK", "var(--vc-fg)") : statRow(
          pixelIcon("check", { scale: 2, color: "var(--vc-green)" }),
          progress.totalCorrect,
          "CORRECT",
          "var(--vc-fg)"
        )
      )
    );
    return h("div", { className: "vc-header" }, brandRow, tabs, stats);
  }

  // src/webview/components/home.ts
  var TOPIC_ICON_COLOR = {
    code: "var(--vc-pink)",
    infrastructure: "var(--vc-cyan)",
    tools: "var(--vc-gold)",
    architecture: "var(--vc-green)",
    security: "var(--vc-red)"
  };
  function progressBar(progress, total) {
    const pct = total === 0 ? 0 : Math.max(0, Math.min(100, progress / total * 100));
    return h(
      "div",
      { className: "pbar pbar--lesson", style: { height: "6px" } },
      h("div", { className: "fill", style: { width: `${pct}%` } })
    );
  }
  function moduleRow(m, isActive) {
    const completed = m.lessons.filter((l) => l.state === "completed").length;
    const iconKind = topicIcon(m.topic);
    const color = TOPIC_ICON_COLOR[m.topic];
    const subtitle = subtitleFor(m);
    return h(
      "button",
      {
        className: `vc-module${isActive ? " vc-module--active" : ""}`,
        on: {
          click: () => send({ type: "openModule", moduleId: m.id })
        }
      },
      h(
        "div",
        { className: "vc-module__icon", style: { color } },
        pixelIcon(iconKind, { scale: 2, color })
      ),
      h(
        "div",
        { className: "vc-module__body" },
        h("div", { className: "vc-module__title" }, m.title.toUpperCase()),
        h("div", { className: "vc-module__sub" }, subtitle),
        h(
          "div",
          { className: "vc-module__progress" },
          progressBar(completed, m.lessons.length),
          h("span", { className: "vc-module__count" }, `${completed}/${m.lessons.length}`)
        )
      )
    );
  }
  function subtitleFor(m) {
    const labels = {
      code: "code",
      infrastructure: "infrastructure",
      tools: "tools",
      architecture: "architecture",
      security: "security"
    };
    return `${labels[m.topic]} \xB7 ${m.track}`;
  }
  function renderHome(state) {
    const { modules, dueCount, capabilities } = state;
    const noWorkspace = !capabilities.hasWorkspaceFolder && !capabilities.hasActiveEditor;
    const head = h(
      "div",
      { className: "vc-list" },
      h(
        "div",
        { className: "vc-list__head" },
        h("span", { className: "vc-list__title" }, "YOUR MODULES"),
        h(
          "button",
          {
            className: "pbtn pbtn--xs",
            on: { click: () => send({ type: "openPicker" }) }
          },
          "+ NEW"
        )
      )
    );
    let body;
    if (modules.length === 0) {
      body = h(
        "div",
        { className: "vc-empty" },
        noWorkspace ? "OPEN A FILE OR\nWORKSPACE TO START" : "NO MODULES YET.\nHIT + NEW OR LET AI INSERT\nCODE TO TRIGGER ONE."
      );
    } else {
      body = h(
        "div",
        { className: "vc-modules" },
        modules.map((m) => moduleRow(m, m.id === state.activeModule?.id))
      );
    }
    const reviewBtn = h(
      "button",
      {
        className: "pbtn pbtn--cyan pbtn--small pbtn--block",
        disabled: dueCount === 0,
        on: { click: () => send({ type: "startReview" }) }
      },
      dueCount > 0 ? `\u21BB START DUE REVIEW (${dueCount})` : "\u21BB NOTHING DUE"
    );
    return h("div", null, head, body, h("div", { className: "vc-bottom-bar" }, reviewBtn));
  }

  // src/webview/components/path.ts
  var OFFSETS = [0, 36, 24, -24, -36, -24, 0, 24, 36, 24];
  function pixelNode(state, topic, onClick) {
    const animating = state === "available" || state === "current";
    const cls = `vc-node vc-node--${state}${animating ? " anim-pulse" : ""}`;
    const iconKind = state === "locked" ? "lock" : state === "complete" ? "check" : topicIcon(topic);
    const iconColor = state === "locked" ? "#888" : state === "complete" ? "#062b0c" : "#2a1f00";
    const button = h(
      "button",
      {
        className: cls,
        disabled: state === "locked",
        on: { click: state === "locked" ? () => {
        } : onClick }
      },
      h(
        "div",
        { style: { color: iconColor, display: "flex" } },
        pixelIcon(iconKind, { scale: 3, color: iconColor })
      )
    );
    if (state === "available" || state === "current") {
      button.appendChild(h("div", { className: "vc-node__ring anim-ring" }));
    }
    return button;
  }
  function lessonRow(lesson, totalLessons, moduleTopic, moduleId, currentIdx, isLast) {
    const moduleLessonId = lesson.id;
    const offset = OFFSETS[lesson.index % OFFSETS.length];
    const isCurrent = lesson.state === "available" && lesson.index === currentIdx;
    const visual = lesson.state === "completed" ? "complete" : isCurrent ? "current" : lesson.state;
    const node = pixelNode(visual, moduleTopic, () => {
      send({ type: "startLesson", moduleId, lessonId: moduleLessonId });
    });
    const label = h(
      "div",
      {
        className: `vc-path__label${lesson.state === "locked" ? " vc-path__label--locked" : ""}`
      },
      `L${lesson.index + 1}: ${truncate(lesson.title, 18)}`
    );
    const wrap = h(
      "div",
      {
        className: "vc-path__node-wrap",
        style: { transform: `translateX(${offset}px)` }
      },
      node,
      label,
      isCurrent ? h("div", { className: "vc-path__start-hint anim-pulse" }, "\u25BC START") : null
    );
    const row = h("div", { className: "vc-path__row" }, wrap);
    if (!isLast) {
      const completedSoFar = lesson.state === "completed";
      row.appendChild(
        h("div", {
          className: `vc-path__connector vc-path__connector--${completedSoFar ? "complete" : "pending"}`
        })
      );
    }
    void totalLessons;
    return row;
  }
  function truncate(s, max) {
    if (s.length <= max) {
      return s;
    }
    return s.slice(0, max - 1) + "\u2026";
  }
  function moduleProgressBar(completed, total) {
    const pct = total === 0 ? 0 : completed / total * 100;
    return h(
      "div",
      { style: { width: "100%" } },
      h(
        "div",
        {
          className: "row",
          style: { justifyContent: "space-between", marginBottom: "4px" }
        },
        h(
          "span",
          {
            className: "font-pixel",
            style: { fontSize: "8px", color: "var(--vc-fg-dim)" }
          },
          "MODULE PROGRESS"
        ),
        h(
          "span",
          {
            className: "font-pixel",
            style: { fontSize: "8px", color: "var(--vc-fg-dim)" }
          },
          `${completed}/${total}`
        )
      ),
      h(
        "div",
        { className: "pbar pbar--lesson", style: { height: "8px" } },
        h("div", { className: "fill", style: { width: `${pct}%` } })
      )
    );
  }
  function renderPath(state) {
    const detail = state.activeModule;
    if (!detail) {
      return null;
    }
    return renderPathInner(detail);
  }
  function renderPathInner(detail) {
    const completed = detail.completedCount;
    const total = detail.lessons.length;
    const currentIdx = detail.lessons.findIndex((l) => l.state === "available");
    const head = h(
      "div",
      { className: "vc-path-head" },
      h(
        "button",
        {
          className: "vc-path-back",
          on: { click: () => send({ type: "closeModule" }) }
        },
        "\u25C0 BACK"
      ),
      h("div", { className: "vc-path-title" }, detail.title.toUpperCase()),
      h(
        "div",
        { className: "vc-path-sub", title: detail.contextLabel },
        detail.sourceFile ? truncate(detail.sourceFile.replace(/\\/g, "/").split("/").slice(-2).join("/"), 40) : detail.contextLabel
      ),
      h("div", { style: { marginTop: "8px" } }, moduleProgressBar(completed, total))
    );
    const path = h(
      "div",
      { className: "vc-path" },
      detail.lessons.map(
        (l, i) => lessonRow(
          l,
          total,
          detail.topic,
          detail.id,
          currentIdx,
          i === detail.lessons.length - 1
        )
      )
    );
    return h("div", null, head, path);
  }

  // src/webview/promptText.ts
  function renderPromptText(text, sourceFile) {
    const out = [];
    const regex = /`([^`\n]+)`/g;
    let last = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) {
        out.push(document.createTextNode(text.slice(last, match.index)));
      }
      const snippet = match[1];
      out.push(codeRef(snippet, sourceFile));
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      out.push(document.createTextNode(text.slice(last)));
    }
    return out;
  }
  function codeRef(snippet, sourceFile) {
    return h(
      "button",
      {
        className: "vc-code-ref",
        title: "Reveal in editor",
        "aria-label": `Reveal ${snippet} in editor`,
        on: {
          click: (ev) => {
            ev.stopPropagation();
            send({ type: "revealSnippet", snippet, file: sourceFile });
          }
        }
      },
      snippet
    );
  }

  // src/webview/components/feedback.ts
  function renderFeedback(fb, q, lesson) {
    if (fb.correct) {
      return h(
        "div",
        { className: "vc-feedback vc-feedback--correct anim-pop" },
        glitch("happy", 3),
        h(
          "div",
          { className: "vc-feedback__body" },
          h("div", { className: "vc-feedback__title" }, `NICE! +${fb.xpDelta} XP`),
          h(
            "div",
            { className: "vc-feedback__msg" },
            renderPromptText(fb.canonicalMessage, q.sourceFile)
          )
        ),
        h(
          "button",
          {
            className: "pbtn pbtn--green pbtn--small",
            on: {
              click: () => {
                finalizeAndAdvance(q, lesson, "correct");
              }
            }
          },
          "NEXT \u25B6"
        )
      );
    }
    const message = fb.personalizedMessage ? fb.personalizedMessage : fb.personalizedLoading ? "thinking\u2026" : fb.canonicalMessage;
    const messageNodes = message === "thinking\u2026" ? [document.createTextNode(message)] : renderPromptText(message, q.sourceFile);
    const showWhyBtn = !fb.personalizedRequested;
    return h(
      "div",
      { className: "vc-feedback vc-feedback--wrong anim-shake" },
      glitch("sad", 3),
      h(
        "div",
        { className: "vc-feedback__body" },
        h("div", { className: "vc-feedback__title" }, "NOT QUITE"),
        h("div", { className: "vc-feedback__msg" }, messageNodes),
        h(
          "div",
          { className: "vc-feedback__actions" },
          showWhyBtn ? h(
            "button",
            {
              className: "pbtn pbtn--cyan pbtn--small",
              title: "Ask the model to explain why your answer was wrong",
              on: {
                click: () => {
                  send({
                    type: "requestWrongFeedback",
                    questionId: q.id,
                    userAnswerText: fb.userAnswerText
                  });
                  store.updateFeedback((f) => ({
                    ...f,
                    personalizedRequested: true,
                    personalizedLoading: true
                  }));
                }
              }
            },
            "? WHY"
          ) : null,
          h(
            "button",
            {
              className: "pbtn pbtn--small",
              on: {
                click: () => {
                  send({ type: "tryAgain", questionId: q.id });
                  store.setFeedback(null);
                  resetCurrentLessonSelection();
                  store.patch({});
                }
              }
            },
            "\u21BB TRY AGAIN"
          ),
          h(
            "button",
            {
              className: "pbtn pbtn--ghost pbtn--small",
              on: {
                click: () => {
                  finalizeAndAdvance(q, lesson, "wrong");
                }
              }
            },
            "SKIP"
          )
        )
      )
    );
  }
  function finalizeAndAdvance(q, lesson, outcome) {
    send({ type: "finalizeQuestion", questionId: q.id, outcome });
    store.setFeedback(null);
    resetCurrentLessonSelection();
    void lesson;
  }

  // src/webview/components/lesson.ts
  var local = null;
  function ensureLocal(q) {
    if (!local || local.questionId !== q.id) {
      local = {
        questionId: q.id,
        mc: void 0,
        order: q.type === "code-order" ? shuffleSeq(q.correctSequence.length, q.id) : void 0
      };
    }
    return local;
  }
  function shuffleSeq(length, seed) {
    const arr = Array.from({ length }, (_, i) => i);
    let h2 = 0;
    for (let i = 0; i < seed.length; i++) {
      h2 = h2 * 31 + seed.charCodeAt(i) >>> 0;
    }
    for (let i = arr.length - 1; i > 0; i--) {
      h2 = h2 * 1664525 + 1013904223 >>> 0;
      const j = h2 % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (length > 1 && arr.every((v, i) => v === i)) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
  }
  function questionHeader(lesson) {
    const q = lesson.currentIndex + 1;
    const total = lesson.questions.length;
    const pct = q / total * 100;
    return h(
      "div",
      { className: "vc-qheader" },
      h(
        "div",
        { className: "vc-qheader__row" },
        h(
          "button",
          {
            className: "vc-qheader__exit",
            on: { click: () => send({ type: "exitLesson" }) }
          },
          "\u25C0 EXIT"
        ),
        h(
          "div",
          { className: "grow" },
          h(
            "div",
            { className: "pbar pbar--lesson", style: { height: "8px" } },
            h("div", { className: "fill", style: { width: `${pct}%` } })
          )
        ),
        h("span", { className: "vc-qheader__counter" }, `${q}/${total}`)
      )
    );
  }
  function codeBlock(code, sourceFile, lineRange) {
    const block = h("pre", { className: "vc-code-block" }, code);
    if (sourceFile && lineRange) {
      const showBtn = h(
        "button",
        {
          className: "vc-code-block__show",
          on: {
            click: (ev) => {
              ev.stopPropagation();
              send({
                type: "revealLines",
                file: sourceFile,
                startLine: lineRange.start,
                endLine: lineRange.end
              });
            }
          }
        },
        "\u{1F4CD} SHOW"
      );
      block.appendChild(showBtn);
    }
    return block;
  }
  function renderMultipleChoice(q, feedback, codeContext) {
    const showResult = !!feedback;
    const sel = ensureLocal(q);
    return h(
      "div",
      { className: "vc-question" },
      h("div", { className: "vc-question__kind vc-question__kind--mc" }, "\u25B8 MULTIPLE CHOICE"),
      h("div", { className: "vc-question__prompt" }, renderPromptText(q.prompt, q.sourceFile)),
      codeContext ? codeBlock(codeContext, q.sourceFile, q.lineRange) : null,
      h(
        "div",
        { className: "vc-options" },
        q.options.map((opt, i) => {
          const isSel = sel.mc === i;
          const isCorrect = i === q.correctIndex;
          let cls = "vc-option";
          if (showResult) {
            if (isCorrect) {
              cls += " vc-option--correct";
            } else if (isSel) {
              cls += " vc-option--wrong";
            }
          } else if (isSel) {
            cls += " vc-option--selected";
          }
          return h(
            "button",
            {
              className: cls,
              "data-locked": showResult ? "true" : void 0,
              on: showResult ? {} : {
                click: () => {
                  sel.mc = i;
                  store.patch({});
                }
              }
            },
            h(
              "div",
              { className: "vc-option__chip" },
              String.fromCharCode(65 + i)
            ),
            h("span", { className: "vc-option__text" }, opt),
            showResult && isCorrect ? h("span", { style: { color: "var(--vc-green)", fontFamily: "var(--pixel)", fontSize: "10px" } }, "\u2713") : null
          );
        })
      )
    );
  }
  function renderCodeOrder(q, feedback) {
    const showResult = !!feedback;
    const sel = ensureLocal(q);
    const order = sel.order ?? Array.from({ length: q.correctSequence.length }, (_, i) => i);
    return h(
      "div",
      { className: "vc-question" },
      h("div", { className: "vc-question__kind vc-question__kind--order" }, "\u25B8 ORDER THE LINES"),
      h("div", { className: "vc-question__prompt" }, renderPromptText(q.prompt, q.sourceFile)),
      h(
        "div",
        { className: "vc-order" },
        order.map((lineIdx, pos) => {
          const isCorrectPos = q.correctSequence[pos] === q.correctSequence[lineIdx];
          let rowCls = "vc-order__row";
          if (showResult) {
            rowCls += isCorrectPos ? " vc-order__row--correct" : " vc-order__row--wrong";
          }
          return h(
            "div",
            { className: rowCls },
            h("span", { className: "vc-order__num" }, String(pos + 1)),
            h("span", { className: "vc-order__line" }, q.correctSequence[lineIdx]),
            !showResult ? h(
              "div",
              { className: "vc-order__arrows" },
              h(
                "button",
                {
                  className: "vc-order__arrow",
                  disabled: pos === 0,
                  on: {
                    click: () => {
                      if (pos === 0) {
                        return;
                      }
                      const next = [...order];
                      [next[pos], next[pos - 1]] = [next[pos - 1], next[pos]];
                      sel.order = next;
                      store.patch({});
                    }
                  }
                },
                "\u25B2"
              ),
              h(
                "button",
                {
                  className: "vc-order__arrow",
                  disabled: pos === order.length - 1,
                  on: {
                    click: () => {
                      if (pos === order.length - 1) {
                        return;
                      }
                      const next = [...order];
                      [next[pos], next[pos + 1]] = [next[pos + 1], next[pos]];
                      sel.order = next;
                      store.patch({});
                    }
                  }
                },
                "\u25BC"
              )
            ) : null
          );
        })
      )
    );
  }
  function checkAnswer(q) {
    if (q.type === "multiple-choice") {
      const choice = local?.mc;
      if (typeof choice !== "number") {
        return { correct: false, payload: null, userText: "(no selection)" };
      }
      return {
        correct: choice === q.correctIndex,
        payload: { kind: "multiple-choice", choiceIndex: choice },
        userText: q.options[choice] ?? "(invalid)"
      };
    }
    const order = local?.order ?? Array.from({ length: q.correctSequence.length }, (_, i) => i);
    const sequence = order.map((i) => q.correctSequence[i]);
    const correct = sequence.every((line, i) => line === q.correctSequence[i]);
    return {
      correct,
      payload: { kind: "code-order", sequence },
      userText: sequence.map((l, i) => `${i + 1}. ${l}`).join("\n")
    };
  }
  function submitButton(q, lesson) {
    const isReady = q.type === "multiple-choice" ? typeof local?.mc === "number" : q.type === "code-order" ? !!local?.order : false;
    return h(
      "div",
      { className: "vc-question-actions" },
      h(
        "button",
        {
          className: "pbtn pbtn--block",
          disabled: !isReady,
          on: {
            click: () => {
              const r = checkAnswer(q);
              if (!r.payload) {
                return;
              }
              const xpDelta = r.correct ? trackXp(lesson.track) : 0;
              const correctText = correctAnswerText(q);
              const fb = {
                questionId: q.id,
                correct: r.correct,
                canonicalMessage: q.explanation,
                personalizedMessage: null,
                personalizedLoading: false,
                personalizedRequested: false,
                userAnswerText: r.userText,
                correctAnswerText: correctText,
                xpDelta
              };
              store.setFeedback(fb);
              send({
                type: "submitAnswer",
                questionId: q.id,
                answer: r.payload,
                correct: r.correct
              });
            }
          }
        },
        q.type === "code-order" ? "CHECK ORDER" : "CHECK ANSWER"
      )
    );
  }
  function trackXp(track) {
    switch (track) {
      case "beginner":
        return 5;
      case "intermediate":
        return 10;
      case "expert":
        return 20;
    }
  }
  function correctAnswerText(q) {
    if (q.type === "multiple-choice") {
      return q.options[q.correctIndex] ?? "";
    }
    return q.correctSequence.map((l, i) => `${i + 1}. ${l}`).join("\n");
  }
  function clearLessonLocalSelection() {
    local = null;
  }
  function resetCurrentLessonSelection() {
    local = null;
  }
  function renderLessonScreen(state) {
    const lesson = state.activeLesson;
    if (!lesson) {
      return null;
    }
    const q = lesson.questions[lesson.currentIndex];
    if (!q) {
      return null;
    }
    const fb = state.feedback && state.feedback.questionId === q.id ? state.feedback : null;
    const codeForMC = q.type === "multiple-choice" && q.lineRange && q.sourceFile ? void 0 : void 0;
    const body = q.type === "multiple-choice" ? renderMultipleChoice(q, fb, codeForMC) : renderCodeOrder(q, fb);
    const footer = fb ? renderFeedback(fb, q, lesson) : submitButton(q, lesson);
    return h("div", null, questionHeader(lesson), body, footer);
  }

  // src/webview/components/complete.ts
  var CONFETTI_COLORS = ["var(--vc-pink)", "var(--vc-gold)", "var(--vc-cyan)", "var(--vc-green)"];
  function confettiPiece(idx, total) {
    const left = idx * 7919 % 100;
    const delay = idx * 1031 % 50 / 100;
    const size = 3 + idx % 3 * 2;
    const color = CONFETTI_COLORS[idx % CONFETTI_COLORS.length];
    void total;
    return h("div", {
      className: "vc-confetti",
      style: {
        left: `${left}%`,
        width: `${size}px`,
        height: `${size}px`,
        background: color,
        animation: `confetti-fall 1.4s ${delay}s steps(8) forwards`
      }
    });
  }
  function renderComplete(state) {
    if (state.screen.kind !== "complete") {
      return null;
    }
    const { correct, total, xpEarned, passed } = state.screen;
    const confetti = passed ? Array.from({ length: 30 }, (_, i) => confettiPiece(i, 30)) : [];
    const stats = h(
      "div",
      { className: "vc-complete__stats pixel-card" },
      h(
        "div",
        { className: "vc-complete__stat" },
        pixelIcon("check", { scale: 2, color: "var(--vc-green)" }),
        h(
          "span",
          { className: "vc-complete__stat-value", style: { color: "var(--vc-green)" } },
          `${correct}/${total}`
        ),
        h("span", { className: "vc-complete__stat-label" }, "CORRECT")
      ),
      h(
        "div",
        { className: "vc-complete__stat" },
        pixelIcon("star", { scale: 2 }),
        h(
          "span",
          { className: "vc-complete__stat-value", style: { color: "var(--vc-gold)" } },
          `+${xpEarned}`
        ),
        h("span", { className: "vc-complete__stat-label" }, "XP EARNED")
      )
    );
    const streakRow = passed && state.progress.streak > 0 ? h(
      "div",
      { className: "vc-complete__streak" },
      h("div", { className: "anim-flame" }, pixelIcon("flame", { scale: 2 })),
      h(
        "span",
        { className: "vc-complete__streak-text" },
        `${state.progress.streak} DAY STREAK!`
      )
    ) : null;
    return h(
      "div",
      { className: "vc-complete" },
      confetti,
      h(
        "div",
        {
          className: "anim-pop",
          style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }
        },
        glitch(passed ? "win" : "sad", 5)
      ),
      h(
        "div",
        {
          className: `vc-complete__title vc-complete__title--${passed ? "win" : "fail"}`
        },
        passed ? "LESSON\nCOMPLETE!" : "KEEP\nTRYING"
      ),
      stats,
      streakRow,
      h(
        "button",
        {
          className: `pbtn ${passed ? "pbtn--gold" : "pbtn--red"} pbtn--block`,
          on: { click: () => send({ type: "completeAcknowledged" }) }
        },
        passed ? "NEXT LESSON \u25B6" : "TRY AGAIN"
      )
    );
  }

  // src/webview/components/picker.ts
  var TOPICS = [
    { id: "code", icon: "code", label: "CODE", desc: "Active selection or file", color: "var(--vc-pink)" },
    { id: "infrastructure", icon: "cap", label: "INFRASTRUCTURE", desc: "package.json, configs, build", color: "var(--vc-cyan)" },
    { id: "tools", icon: "star", label: "TOOLS", desc: "Deps, scripts, what they do", color: "var(--vc-gold)" },
    { id: "architecture", icon: "cap", label: "ARCHITECTURE", desc: "Directory tree & boundaries", color: "var(--vc-green)" },
    { id: "security", icon: "lock", label: "SECURITY", desc: "Injection, validation gaps", color: "var(--vc-red)" }
  ];
  function isAvailable(t, caps) {
    switch (t) {
      case "code":
        return caps.hasActiveEditor;
      case "infrastructure":
      case "architecture":
        return caps.hasWorkspaceFolder;
      case "tools":
        return caps.hasPackageJson;
      case "security":
        return caps.hasActiveEditor || caps.hasWorkspaceFolder;
    }
  }
  function renderPicker(state) {
    const caps = state.capabilities;
    const head = h(
      "div",
      { className: "vc-picker__head" },
      glitch("think", 3),
      h(
        "div",
        { className: "col grow" },
        h("div", { className: "vc-picker__title" }, "NEW MODULE"),
        h("div", { className: "vc-picker__sub" }, "What do you want to learn?")
      ),
      h(
        "button",
        {
          className: "vc-picker__close",
          on: { click: () => send({ type: "closePicker" }) }
        },
        "\u2715"
      )
    );
    const rows = h(
      "div",
      { className: "vc-picker__rows" },
      TOPICS.map((t) => {
        const available = isAvailable(t.id, caps);
        return h(
          "button",
          {
            className: "vc-picker__row",
            disabled: !available,
            style: {
              boxShadow: `inset 4px 0 0 0 ${t.color}, inset 0 0 0 1px var(--vc-line)`
            },
            on: {
              click: () => {
                if (!available) {
                  return;
                }
                send({ type: "newModule", topic: t.id });
              }
            }
          },
          h(
            "div",
            { className: "vc-picker__icon", style: { color: t.color } },
            pixelIcon(t.icon, { scale: 2, color: t.color })
          ),
          h(
            "div",
            { className: "vc-picker__body" },
            h("div", { className: "vc-picker__label", style: { color: t.color } }, t.label),
            h(
              "div",
              { className: "vc-picker__desc" },
              available ? t.desc : `${t.desc} \xB7 unavailable`
            )
          ),
          h("span", { className: "vc-picker__chev" }, "\u25B6")
        );
      })
    );
    return h("div", { className: "vc-picker" }, head, rows);
  }

  // src/webview/components/pulse.ts
  function renderPulse(info) {
    return h(
      "div",
      { className: "vc-pulse anim-pop" },
      glitch("surprise", 3),
      h(
        "div",
        { className: "vc-pulse__body" },
        h(
          "div",
          { className: "vc-pulse__head" },
          h("div", { className: "vc-pulse__title" }, "PULSE DETECTED"),
          h(
            "button",
            {
              className: "vc-pulse__close",
              on: { click: () => send({ type: "dismissPulse" }) }
            },
            "\u2715"
          )
        ),
        h(
          "div",
          { className: "vc-pulse__msg" },
          "AI just inserted ",
          h("strong", null, `${info.lines} lines`),
          ` (${info.chars} chars). Quiz yourself before you ship?`
        ),
        h(
          "div",
          { className: "vc-pulse__actions" },
          h(
            "button",
            {
              className: "pbtn pbtn--xs",
              on: { click: () => send({ type: "openPicker" }) }
            },
            "VIBE CHECK ME"
          ),
          h(
            "button",
            {
              className: "pbtn pbtn--ghost pbtn--xs",
              on: { click: () => send({ type: "dismissPulse" }) }
            },
            "LATER"
          )
        )
      )
    );
  }

  // src/webview/render.ts
  function generatingOverlay(state) {
    const label = state.generatingTopic ? `GENERATING ${state.generatingTopic.toUpperCase()} MODULE\u2026` : "WORKING\u2026";
    return h(
      "div",
      { className: "vc-generating" },
      glitch("think", 4),
      h("div", { className: "vc-generating__text" }, label)
    );
  }
  function errorBanner(message) {
    return h(
      "div",
      { className: "vc-error-banner", on: { click: () => send({ type: "dismissError" }) } },
      message
    );
  }
  function renderScreenBody(state) {
    if (state.isGenerating) {
      return generatingOverlay(state);
    }
    switch (state.screen.kind) {
      case "home":
        return renderHome(state) ?? renderHome(state);
      case "path": {
        const path = renderPath(state);
        return path ?? renderHome(state);
      }
      case "lesson": {
        const lesson = renderLessonScreen(state);
        return lesson ?? renderHome(state);
      }
      case "complete":
        return renderComplete(state) ?? renderHome(state);
      case "picker":
        return renderPicker(state);
    }
  }
  function showHeader(state) {
    if (state.isGenerating) {
      return true;
    }
    if (state.screen.kind === "lesson") {
      return false;
    }
    return true;
  }
  function render(rootEl, state) {
    clear(rootEl);
    const screen = h("div", { id: "vc-screen" });
    if (showHeader(state)) {
      rootEl.appendChild(renderHeader(state));
    }
    if (state.error) {
      rootEl.appendChild(errorBanner(state.error));
    }
    if (state.pulse && state.screen.kind === "home") {
      rootEl.appendChild(renderPulse(state.pulse));
    }
    screen.appendChild(renderScreenBody(state));
    rootEl.appendChild(screen);
  }

  // src/webview/index.ts
  var root = document.getElementById("vc-root");
  if (!root) {
    throw new Error("vc-root element missing");
  }
  store.subscribe((state) => {
    render(root, state);
  });
  window.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") {
      return;
    }
    switch (msg.type) {
      case "state":
        store.hydrate(msg.state);
        return;
      case "wrongFeedback": {
        store.updateFeedback(
          (f) => f.questionId === msg.questionId ? { ...f, personalizedMessage: msg.message, personalizedLoading: false } : f
        );
        return;
      }
      case "error":
        store.setError(msg.message);
        return;
    }
  });
  var lastLessonKey = "";
  store.subscribe((state) => {
    const key = state.activeLesson ? `${state.activeLesson.lessonId}:${state.activeLesson.currentIndex}` : "";
    if (key !== lastLessonKey) {
      clearLessonLocalSelection();
      lastLessonKey = key;
    }
  });
  send({ type: "ready" });
  render(root, store.getState());
})();
//# sourceMappingURL=sidebar.js.map
