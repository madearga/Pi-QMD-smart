/**
 * QMD Smart Context Extension
 *
 * Toggle between 3 memory context modes with a terminal UI:
 *   FULL   — Auto-inject QMD search results every turn (like pi-memory)
 *   HYBRID — On-demand recall tool + system hint (token efficient) ← default
 *   NONE   — No memory context at all
 *
 * Shortcut: Ctrl+Alt+M   Command: /qmd
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, type Component, type Focusable } from "@mariozechner/pi-tui";

// ─── Types ───────────────────────────────────────────────────────────────────

type MemoryMode = "full" | "hybrid" | "none";

// ─── Constants ───────────────────────────────────────────────────────────────

const MODE_LIST: MemoryMode[] = ["full", "hybrid", "none"];

const MODE_CONFIG: Record<MemoryMode, {
  label: string;
  icon: string;
  desc: string;
  tokens: string;
  color: string;
}> = {
  full: {
    label: "FULL",
    icon: "●",
    desc: "Auto-inject QMD results every turn + recall tool",
    tokens: "~14K tokens/turn",
    color: "green",
  },
  hybrid: {
    label: "HYBRID",
    icon: "◐",
    desc: "On-demand recall tool + light system hint",
    tokens: "~100B tokens/turn",
    color: "yellow",
  },
  none: {
    label: "NONE",
    icon: "○",
    desc: "No memory context injection at all",
    tokens: "0 tokens/turn",
    color: "red",
  },
};

const STATE_DIR = path.join(process.env.HOME || "~", ".pi", "agent");
const STATE_FILE = path.join(STATE_DIR, "qmd-smart-state.json");

// ─── State ───────────────────────────────────────────────────────────────────

function loadState(): MemoryMode {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    if (MODE_LIST.includes(data.mode)) return data.mode;
  } catch { /* fall through */ }
  return "hybrid";
}

function saveState(mode: MemoryMode): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    mode,
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
          // Strip ANSI escape sequences that qmd may emit
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

// ─── Mode Selector Component ─────────────────────────────────────────────────

class ModeSelector implements Component, Focusable {
  private selectedIndex: number;
  private _focused = true;
  private onDone: (mode: MemoryMode) => void;
  private currentMode: MemoryMode;
  private theme: any;
  private qmdOk: boolean;

  constructor(
    currentMode: MemoryMode,
    theme: any,
    qmdOk: boolean,
    onDone: (mode: MemoryMode) => void,
  ) {
    this.currentMode = currentMode;
    this.selectedIndex = MODE_LIST.indexOf(currentMode);
    this.theme = theme;
    this.qmdOk = qmdOk;
    this.onDone = onDone;
  }

  get focused() { return this._focused; }
  set focused(v: boolean) { this._focused = v; }

  invalidate() {}

  handleInput(data: string): boolean {
    // Navigate
    if (matchesKey(data, Key.up()) || matchesKey(data, Key.left())) {
      this.selectedIndex = (this.selectedIndex - 1 + MODE_LIST.length) % MODE_LIST.length;
      return true;
    }
    if (matchesKey(data, Key.down()) || matchesKey(data, Key.right())) {
      this.selectedIndex = (this.selectedIndex + 1) % MODE_LIST.length;
      return true;
    }
    // Confirm
    if (matchesKey(data, Key.enter())) {
      this.onDone(MODE_LIST[this.selectedIndex]);
      return true;
    }
    // Cancel
    if (matchesKey(data, Key.escape())) {
      this.onDone(this.currentMode);
      return true;
    }
    // Quick select 1/2/3
    if (data === "1") { this.onDone("full"); return true; }
    if (data === "2") { this.onDone("hybrid"); return true; }
    if (data === "3") { this.onDone("none"); return true; }
    // Tab to cycle
    if (matchesKey(data, Key.tab())) {
      this.selectedIndex = (this.selectedIndex + 1) % MODE_LIST.length;
      return true;
    }
    return false;
  }

  render(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const w = Math.min(width, 64);

    // Header
    lines.push("");
    lines.push(`  🔍  QMD Smart Context`);
    lines.push(`  ${"─".repeat(w - 6)}`);

    // QMD status
    if (!this.qmdOk) {
      lines.push(`  ⚠  QMD not detected — install: bun install -g https://github.com/tobi/qmd`);
      lines.push("");
    }

    // Mode options
    for (let i = 0; i < MODE_LIST.length; i++) {
      const mode = MODE_LIST[i];
      const config = MODE_CONFIG[mode];
      const isSelected = i === this.selectedIndex;
      const isCurrent = mode === this.currentMode;

      const cursor = isSelected ? " ❯ " : "   ";
      const check = isCurrent ? " ✓ " : "   ";
      const num = ` ${i + 1}.`;

      const modeStyle = isSelected
        ? t.fg("accent", `${num} ${config.icon}  ${config.label}`)
        : `${num} ${config.icon}  ${config.label}`;

      const desc = t.fg("muted", ` — ${config.desc}`);
      const tokenInfo = t.fg("muted", ` (${config.tokens})`);

      lines.push(`${cursor}${check}${modeStyle}${desc}`);
      lines.push(`${cursor}   ${tokenInfo}`);
      lines.push("");
    }

    // Footer
    lines.push(`  ${"─".repeat(w - 6)}`);
    lines.push(`  ↑↓  Navigate    Enter  Select    1/2/3  Quick    Tab  Cycle    Esc  Cancel`);

    lines.push("");
    return lines;
  }
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function qmdSmartExtension(pi: ExtensionAPI) {
  let currentMode = loadState();

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
        query: {
          type: "string" as const,
          description: "What to search for",
        },
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
      // Check mode
      if (currentMode === "none") {
        return {
          content: [{
            type: "text" as const,
            text: "Memory context is disabled. Press Ctrl+Alt+M or use /qmd to enable.",
          }],
        };
      }

      // Check QMD
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
        : args.mode === "deep" ? "deep"
        : "keyword";
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
        return {
          content: [{ type: "text" as const, text: results }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${err.message}` }],
        };
      }
    },
  });

  // ── Context injection hook ──────────────────────────────────────────────

  pi.on("before_agent_start", async (event: any) => {
    if (currentMode === "none") return;

    // FULL: auto-search and inject results
    if (currentMode === "full") {
      if (!qmdAvailable) return;

      const prompt = (event.prompt ?? "").trim().slice(0, 200);
      if (!prompt) return;

      // Sanitize for search
      const sanitized = prompt.replace(/[\x00-\x1f\x7f]/g, " ").trim();
      if (!sanitized) return;

      try {
        const results = await Promise.race([
          runQmdSearch(sanitized, "keyword", 3),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 3000),
          ),
        ]);

        if (!results) return;

        const injection = [
          "",
          "## Relevant Past Context (QMD auto-search)",
          "The following were found by searching your notes for: \"" + sanitized.slice(0, 80) + "\"",
          "",
          results,
        ].join("\n");

        return { systemPrompt: event.systemPrompt + injection };
      } catch {
        // Timeout or error — skip silently
        return;
      }
    }

    // HYBRID: light hint only
    if (currentMode === "hybrid") {
      return {
        systemPrompt: event.systemPrompt +
          "\n\nUse the `recall` tool to search past context, decisions, and notes when needed. " +
          "This is more token-efficient than auto-injection — only search when the user asks about past context or you need historical information.",
      };
    }
  });

  // ── Mode selector ───────────────────────────────────────────────────────

  const openModeSelector = async (ctx: ExtensionContext) => {
    try {
      const selected = await (ctx as any).ui.custom<MemoryMode>(
        (tui: any, theme: any, _keybindings: any, done: (mode: MemoryMode) => void) => {
          const selector = new ModeSelector(currentMode, theme, qmdAvailable, (mode) => done(mode));
          return selector;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "70%",
            maxHeight: "50%",
            anchor: "bottom-center" as const,
            margin: { top: 0, bottom: 2, left: 2, right: 2 },
            nonCapturing: true,
          },
        },
      );

      if (selected && selected !== currentMode) {
        currentMode = selected;
        saveState(currentMode);
        const config = MODE_CONFIG[currentMode];
        try {
          (ctx as any).ui.notify(
            `🔍 QMD → ${config.icon} ${config.label} — ${config.desc}`,
            currentMode === "none" ? "warning" : "info",
          );
        } catch { /* notify not available */ }
      }
    } catch {
      // Overlay blocked or dismissed
    }
  };

  // ── Shortcut ────────────────────────────────────────────────────────────

  pi.registerShortcut("ctrl+alt+m", {
    description: "Toggle QMD memory mode (full/hybrid/none)",
    handler: (_event: any, ctx: ExtensionContext) => openModeSelector(ctx),
  });

  // ── Command ─────────────────────────────────────────────────────────────

  pi.registerCommand("qmd", {
    description: "Open QMD memory mode selector",
    handler: (_args: any, ctx: ExtensionContext) => openModeSelector(ctx),
  });

  // ── Startup ─────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
    // Detect QMD availability
    qmdAvailable = await detectQmd();

    const config = MODE_CONFIG[currentMode];
    const qmdStatus = qmdAvailable ? "✅" : "⚠️  qmd not found";
    try {
      (ctx as any).ui.notify(
        `🔍 QMD ${config.icon} ${config.label} — ${config.tokens}  |  ${qmdStatus}`,
        qmdAvailable ? "info" : "warning",
      );
    } catch { /* notify not available */ }
  });
}
