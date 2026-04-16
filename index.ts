/**
 * QMD Smart Context — Unified Memory Control Panel
 *
 * One UI to toggle all memory extensions:
 *   1. QMD Search        — full / hybrid / none
 *   2. Self-Learning      — on / off (pi-self-learning)
 *   3. Pi-Memory Inject   — on / off (pi-memory context injection)
 *
 * Shortcut: Ctrl+Alt+M   Command: /qmd   Command: /memory
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, type Component, type Focusable } from "@mariozechner/pi-tui";

// ─── Types ───────────────────────────────────────────────────────────────────

type QmdMode = "full" | "hybrid" | "none";

interface PanelState {
  qmd: QmdMode;
  selfLearning: boolean;
  piMemory: boolean;
}

interface PanelRow {
  key: keyof PanelState;
  label: string;
  icon: string;
  desc: string;
  type: "qmd" | "toggle";
}

// ─── Constants ───────────────────────────────────────────────────────────────

const QMD_MODES: QmdMode[] = ["full", "hybrid", "none"];

const QMD_LABELS: Record<QmdMode, { icon: string; label: string; color: string }> = {
  full:   { icon: "●", label: "FULL",    color: "green" },
  hybrid: { icon: "◐", label: "HYBRID",  color: "yellow" },
  none:   { icon: "○", label: "NONE",    color: "red" },
};

const PANEL_ROWS: PanelRow[] = [
  {
    key: "qmd",
    label: "QMD Search",
    icon: "🔍",
    desc: "Search past context via QMD (keyword/semantic/deep)",
    type: "qmd",
  },
  {
    key: "selfLearning",
    label: "Self-Learning",
    icon: "🧠",
    desc: "Auto-reflect after tasks, learn from mistakes",
    type: "toggle",
  },
  {
    key: "piMemory",
    label: "Pi-Memory",
    icon: "📝",
    desc: "Inject MEMORY.md, scratchpad, daily logs",
    type: "toggle",
  },
];

const STATE_DIR = path.join(process.env.HOME || "~", ".pi", "agent");
const STATE_FILE = path.join(STATE_DIR, "qmd-smart-state.json");

// ─── State Persistence ───────────────────────────────────────────────────────

const DEFAULT_STATE: PanelState = {
  qmd: "hybrid",
  selfLearning: true,
  piMemory: true,
};

function loadState(): PanelState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return {
      qmd: QMD_MODES.includes(data.qmd) ? data.qmd : DEFAULT_STATE.qmd,
      selfLearning: typeof data.selfLearning === "boolean" ? data.selfLearning : DEFAULT_STATE.selfLearning,
      piMemory: typeof data.piMemory === "boolean" ? data.piMemory : DEFAULT_STATE.piMemory,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state: PanelState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    ...state,
    updated: new Date().toISOString(),
  }));
}

// ─── QMD Detection ───────────────────────────────────────────────────────────

let qmdAvailable = false;

function detectQmd(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("qmd", ["status"], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

/** Check if pi-self-learning is installed by looking for its settings. */
function detectSelfLearning(): boolean {
  try {
    // Check if the npm package is installed
    const paths = [
      path.join(STATE_DIR, "..", "node_modules", "pi-self-learning", "package.json"),
      "/opt/homebrew/lib/node_modules/pi-self-learning/package.json",
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Check if pi-memory is installed. */
function detectPiMemory(): boolean {
  try {
    const paths = [
      path.join(STATE_DIR, "..", "node_modules", "pi-memory", "package.json"),
      "/opt/homebrew/lib/node_modules/pi-memory/package.json",
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── QMD Search ──────────────────────────────────────────────────────────────

function runQmdSearch(
  query: string,
  mode: "keyword" | "semantic" | "deep" = "keyword",
  limit = 3,
): Promise<string> {
  const subcommand = mode === "semantic" ? "vsearch" : mode === "deep" ? "query" : "search";

  return new Promise((resolve) => {
    execFile(
      "qmd",
      [subcommand, "--json", "-n", String(limit), query],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) { resolve(""); return; }
        try {
          const cleaned = stdout
            .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
            .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, "");

          const parsed = JSON.parse(cleaned);
          const list = Array.isArray(parsed)
            ? parsed
            : ((parsed as any).results ?? (parsed as any).hits ?? []);

          if (list.length === 0) { resolve(""); return; }

          const snippets = list.slice(0, limit).map((r: any) => {
            const text = r.content ?? r.chunk ?? r.snippet ?? "";
            const file = r.path ?? r.file ?? "";
            const score = r.score != null ? ` (${r.score.toFixed(2)})` : "";
            return file ? `${file}${score}\n${text.trim()}` : text.trim();
          }).filter(Boolean);

          resolve(snippets.join("\n\n---\n\n"));
        } catch {
          resolve("");
        }
      },
    );
  });
}

// ─── Unified Control Panel ───────────────────────────────────────────────────

class ControlPanel implements Component, Focusable {
  private selectedIndex = 0;
  private _focused = true;
  private onDone: (state: PanelState) => void;
  private state: PanelState;
  private initialState: PanelState;
  private theme: any;
  private qmdOk: boolean;
  private selfLearningInstalled: boolean;
  private piMemoryInstalled: boolean;

  constructor(
    state: PanelState,
    theme: any,
    qmdOk: boolean,
    selfLearningInstalled: boolean,
    piMemoryInstalled: boolean,
    onDone: (state: PanelState) => void,
  ) {
    this.state = { ...state };
    this.initialState = { ...state };
    this.theme = theme;
    this.qmdOk = qmdOk;
    this.selfLearningInstalled = selfLearningInstalled;
    this.piMemoryInstalled = piMemoryInstalled;
    this.onDone = onDone;
  }

  get focused() { return this._focused; }
  set focused(v: boolean) { this._focused = v; }

  invalidate() {}

  private toggleRow(index: number): void {
    const row = PANEL_ROWS[index];
    if (row.type === "toggle") {
      (this.state as any)[row.key] = !(this.state as any)[row.key];
    } else if (row.type === "qmd") {
      const modes: QmdMode[] = ["full", "hybrid", "none"];
      const currentIdx = modes.indexOf(this.state.qmd);
      this.state.qmd = modes[(currentIdx + 1) % modes.length];
    }
  }

  handleInput(data: string): boolean {
    // Navigate
    if (matchesKey(data, Key.up()) || matchesKey(data, Key.left())) {
      this.selectedIndex = (this.selectedIndex - 1 + PANEL_ROWS.length) % PANEL_ROWS.length;
      return true;
    }
    if (matchesKey(data, Key.down()) || matchesKey(data, Key.right())) {
      this.selectedIndex = (this.selectedIndex + 1) % PANEL_ROWS.length;
      return true;
    }
    // Toggle / Confirm
    if (matchesKey(data, Key.enter()) || matchesKey(data, Key.tab())) {
      this.toggleRow(this.selectedIndex);
      return true;
    }
    // Save & Close
    if (data === "s" || data === "S") {
      this.onDone(this.state);
      return true;
    }
    // Cancel
    if (matchesKey(data, Key.escape())) {
      this.onDone(this.initialState);
      return true;
    }
    // Quick keys
    if (data === "1") { this.selectedIndex = 0; this.toggleRow(0); return true; }
    if (data === "2") { this.selectedIndex = 1; this.toggleRow(1); return true; }
    if (data === "3") { this.selectedIndex = 2; this.toggleRow(2); return true; }
    // Quick QMD modes
    if (data === "f" || data === "F") { this.state.qmd = "full"; this.selectedIndex = 0; return true; }
    if (data === "h" || data === "H") { this.state.qmd = "hybrid"; this.selectedIndex = 0; return true; }
    if (data === "n" || data === "N") { this.state.qmd = "none"; this.selectedIndex = 0; return true; }
    // Toggle all
    if (data === "a" || data === "A") {
      const allOff = this.state.qmd === "none" && !this.state.selfLearning && !this.state.piMemory;
      if (allOff) {
        this.state = { qmd: "hybrid", selfLearning: true, piMemory: true };
      } else {
        this.state = { qmd: "none", selfLearning: false, piMemory: false };
      }
      return true;
    }
    return false;
  }

  render(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const w = Math.min(width, 68);

    // Header
    lines.push("");
    lines.push(`  ⚡  Memory Control Panel`);
    lines.push(`  ${"─".repeat(w - 6)}`);

    // Rows
    for (let i = 0; i < PANEL_ROWS.length; i++) {
      const row = PANEL_ROWS[i];
      const isSelected = i === this.selectedIndex;
      const cursor = isSelected ? " ❯ " : "   ";

      if (row.type === "qmd") {
        const qmd = QMD_LABELS[this.state.qmd];
        const modeColor = qmd.color;
        const statusIcon = this.state.qmd !== "none" ? "✓" : " ";
        const qmdStatus = this.qmdOk ? "✅" : "⚠️";

        const modeStr = isSelected
          ? t.fg("accent", `${qmd.icon} ${qmd.label}`)
          : `${qmd.icon} ${qmd.label}`;

        lines.push(`${cursor} ${statusIcon}  ${row.icon}  ${row.label}`);
        lines.push(`${cursor}       ${t.fg("muted", row.desc)}`);

        const tokenInfo = this.state.qmd === "full" ? "~14K/turn"
          : this.state.qmd === "hybrid" ? "~100B/turn" : "0/turn";

        lines.push(
          `${cursor}       Mode: ${modeStr}` +
          `  ${t.fg("muted", `(${tokenInfo})`)}` +
          `  ${qmdStatus}`
        );

      } else {
        // Toggle
        const isOn = (this.state as any)[row.key] as boolean;
        const toggleIcon = isOn ? "●" : "○";
        const statusIcon = isOn ? "✓" : " ";
        const toggleColor = isOn ? "green" : "red";

        // Check if extension is installed
        let installed = true;
        if (row.key === "selfLearning") installed = this.selfLearningInstalled;
        if (row.key === "piMemory") installed = this.piMemoryInstalled;

        const toggleStr = isSelected
          ? t.fg("accent", `${toggleIcon} ${isOn ? "ON" : "OFF"}`)
          : `${toggleIcon} ${isOn ? "ON" : "OFF"}`;

        lines.push(`${cursor} ${statusIcon}  ${row.icon}  ${row.label}`);
        lines.push(`${cursor}       ${t.fg("muted", row.desc)}`);

        if (!installed) {
          lines.push(
            `${cursor}       ${t.fg("warning", "⚠  Not installed —")}` +
            ` pi install npm:pi-${row.key === "selfLearning" ? "self-learning" : "memory"}`
          );
        } else {
          const label = isOn ? "active" : "disabled";
          lines.push(`${cursor}       ${toggleStr}  ${t.fg("muted", `(${label})`)}`);
        }
      }
      lines.push("");
    }

    // Estimated token cost
    const totalTokens = this.estimateTokens();
    lines.push(`  ${"─".repeat(w - 6)}`);
    lines.push(`  💰  Est. injection: ${t.fg("accent", totalTokens)}/turn`);

    // Footer
    lines.push(`  ${"─".repeat(w - 6)}`);
    lines.push(
      `  ↑↓ Nav  Enter/Tab Toggle  1/2/3 Quick  ` +
      `A All  S Save  Esc Cancel`
    );
    lines.push(
      `  F Full  H Hybrid  N None (QMD quick)`
    );
    lines.push("");

    return lines;
  }

  private estimateTokens(): string {
    if (this.state.qmd === "none" && !this.state.selfLearning && !this.state.piMemory) {
      return "~0";
    }
    let estimate = 0;
    // QMD
    if (this.state.qmd === "full") estimate += 14;
    else if (this.state.qmd === "hybrid") estimate += 0.1;
    // Self-learning (CORE.md)
    if (this.state.selfLearning) estimate += 4;
    // Pi-memory (MEMORY.md + scratchpad + daily)
    if (this.state.piMemory) estimate += 10;
    return `~${estimate}K`;
  }
}

// ─── Pi-Memory Context Suppression ───────────────────────────────────────────
//
// When pi-memory is toggled OFF, we suppress its context injection by
// overriding the PI_MEMORY_NO_SEARCH env var before its before_agent_start
// handler runs. We use a high-priority hook.

// ─── Extension ───────────────────────────────────────────────────────────────

export default function qmdSmartExtension(pi: ExtensionAPI) {
  let state = loadState();
  let selfLearningInstalled = false;
  let piMemoryInstalled = false;

  // ── recall tool ──────────────────────────────────────────────────────────

  pi.registerTool({
    name: "recall",
    label: "recall",
    description:
      "Search past context, decisions, and notes using QMD. " +
      "Use when you need to remember something from previous sessions or files. " +
      "Modes: keyword (fast, ~30ms), semantic (vector, ~2s), deep (hybrid+rerank, ~10s).",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "What to search for" },
        mode: {
          type: "string" as const,
          enum: ["keyword", "semantic", "deep"],
          description: "Search mode (default: keyword)",
        },
        limit: {
          type: "number" as const,
          description: "Max results (default: 5, max: 20)",
        },
      },
      required: ["query"],
    },
    execute: async (_toolCallId: string, args: any) => {
      if (state.qmd === "none") {
        return {
          content: [{
            type: "text" as const,
            text: "Memory context is disabled. Press Ctrl+Alt+M or use /qmd to enable.",
          }],
        };
      }

      if (!qmdAvailable) {
        return {
          content: [{
            type: "text" as const,
            text: "QMD is not installed. Install with: bun install -g https://github.com/tobi/qmd",
          }],
        };
      }

      const query = String(args.query || "").trim();
      const searchMode = args.mode === "semantic" ? "semantic"
        : args.mode === "deep" ? "deep" : "keyword";
      const limit = Math.min(Number(args.limit) || 5, 20);

      if (!query) {
        return {
          content: [{ type: "text" as const, text: "Please provide a search query." }],
        };
      }

      try {
        const results = await runQmdSearch(query, searchMode, limit);
        if (!results) {
          return {
            content: [{
              type: "text" as const,
              text: `No results found for "${query}" (${searchMode} mode). Try rephrasing or switching modes.`,
            }],
          };
        }
        return { content: [{ type: "text" as const, text: results }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Search error: ${err.message}` }] };
      }
    },
  });

  // ── Context injection hook (QMD only) ────────────────────────────────────

  pi.on("before_agent_start", async (event: any) => {
    const modifications: { systemPrompt?: string } = {};

    // ── QMD injection ──
    if (state.qmd === "full") {
      if (!qmdAvailable) return;

      const prompt = (event.prompt ?? "").trim().slice(0, 200);
      if (!prompt) return;

      const sanitized = prompt.replace(/[\x00-\x1f\x7f]/g, " ").trim();
      if (!sanitized) return;

      try {
        const results = await Promise.race([
          runQmdSearch(sanitized, "keyword", 3),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 3000),
          ),
        ]);

        if (results) {
          const injection = [
            "",
            "## Relevant Past Context (QMD auto-search)",
            `Found by searching: "${sanitized.slice(0, 80)}"`,
            "",
            results,
          ].join("\n");
          modifications.systemPrompt = event.systemPrompt + injection;
        }
      } catch {
        // Timeout — skip silently
      }
    }

    if (state.qmd === "hybrid") {
      modifications.systemPrompt = (modifications.systemPrompt ?? event.systemPrompt) +
        "\n\nUse the `recall` tool to search past context, decisions, and notes when needed. " +
        "This is more token-efficient than auto-injection — only search when the user asks about past context or you need historical information.";
    }

    // ── Pi-Memory suppression ──
    // When piMemory is OFF, set env var to suppress pi-memory's auto-injection
    if (!state.piMemory) {
      process.env.PI_MEMORY_NO_SEARCH = "1";
    } else {
      // Only clear it if we originally set it
      delete process.env.PI_MEMORY_NO_SEARCH;
    }

    // ── Self-Learning suppression ──
    // When selfLearning is OFF, set env var to suppress pi-self-learning
    if (!state.selfLearning) {
      process.env.PI_SELF_LEARNING_DISABLED = "1";
    } else {
      delete process.env.PI_SELF_LEARNING_DISABLED;
    }

    return Object.keys(modifications).length > 0 ? modifications : undefined;
  });

  // ── Control Panel ────────────────────────────────────────────────────────

  const openControlPanel = async (ctx: ExtensionContext) => {
    try {
      const selected = await (ctx as any).ui.custom<PanelState>(
        (tui: any, theme: any, _keybindings: any, done: (s: PanelState) => void) => {
          const panel = new ControlPanel(
            state, theme,
            qmdAvailable,
            selfLearningInstalled,
            piMemoryInstalled,
            (newState) => done(newState),
          );
          return panel;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "75%",
            maxHeight: "60%",
            anchor: "bottom-center" as const,
            margin: { top: 0, bottom: 2, left: 2, right: 2 },
            nonCapturing: true,
          },
        },
      );

      if (selected) {
        const changed =
          selected.qmd !== state.qmd ||
          selected.selfLearning !== state.selfLearning ||
          selected.piMemory !== state.piMemory;

        state = { ...selected };
        saveState(state);

        if (changed) {
          // Apply env var changes immediately
          if (!state.piMemory) {
            process.env.PI_MEMORY_NO_SEARCH = "1";
          } else {
            delete process.env.PI_MEMORY_NO_SEARCH;
          }
          if (!state.selfLearning) {
            process.env.PI_SELF_LEARNING_DISABLED = "1";
          } else {
            delete process.env.PI_SELF_LEARNING_DISABLED;
          }

          const parts: string[] = [];
          const qmdCfg = QMD_LABELS[state.qmd];
          parts.push(`QMD ${qmdCfg.icon} ${qmdCfg.label}`);
          parts.push(`🧠 ${state.selfLearning ? "ON" : "OFF"}`);
          parts.push(`📝 ${state.piMemory ? "ON" : "OFF"}`);

          try {
            (ctx as any).ui.notify(
              `⚡ Memory: ${parts.join(" | ")} — ~${estimateTokens(state)}K/turn`,
              "info",
            );
          } catch { /* notify not available */ }
        }
      }
    } catch {
      // Overlay blocked or dismissed
    }
  };

  function estimateTokens(s: PanelState): number {
    let e = 0;
    if (s.qmd === "full") e += 14;
    else if (s.qmd === "hybrid") e += 0.1;
    if (s.selfLearning) e += 4;
    if (s.piMemory) e += 10;
    return Math.round(e * 10) / 10;
  }

  // ── Shortcut ────────────────────────────────────────────────────────────

  pi.registerShortcut("ctrl+alt+m", {
    description: "Open memory control panel",
    handler: (_event: any, ctx: ExtensionContext) => openControlPanel(ctx),
  });

  // ── Commands ────────────────────────────────────────────────────────────

  pi.registerCommand("qmd", {
    description: "Open memory control panel",
    handler: (_args: any, ctx: ExtensionContext) => openControlPanel(ctx),
  });

  pi.registerCommand("memory", {
    description: "Open memory control panel",
    handler: (_args: any, ctx: ExtensionContext) => openControlPanel(ctx),
  });

  // ── Startup ─────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
    qmdAvailable = await detectQmd();
    selfLearningInstalled = detectSelfLearning();
    piMemoryInstalled = detectPiMemory();

    // Apply saved state as env vars
    if (!state.piMemory) {
      process.env.PI_MEMORY_NO_SEARCH = "1";
    }
    if (!state.selfLearning) {
      process.env.PI_SELF_LEARNING_DISABLED = "1";
    }

    const qmdCfg = QMD_LABELS[state.qmd];
    const qmdStatus = qmdAvailable ? "✅" : "⚠️";
    const parts: string[] = [
      `QMD ${qmdCfg.icon} ${qmdCfg.label} ${qmdStatus}`,
      `🧠 ${state.selfLearning ? "ON" : "OFF"}`,
      `📝 ${state.piMemory ? "ON" : "OFF"}`,
    ];

    try {
      (ctx as any).ui.notify(
        `⚡ Memory Panel: ${parts.join(" | ")} — ~${estimateTokens(state)}K/turn`,
        "info",
      );
    } catch { /* notify not available */ }
  });
}
