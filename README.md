# qmd-smart

Toggle QMD memory context between 3 modes directly from the terminal.

## Install

```bash
pi install /Users/madearga/pi-extensions/qmd-smart
```

Then reload: `/reload`

## Usage

| Action | How |
|---|---|
| Open mode selector | `Ctrl+Alt+M` or `/qmd` |
| Navigate | `↑` `↓` or `←` `→` |
| Quick select | `1` (full) `2` (hybrid) `3` (none) |
| Cycle modes | `Tab` |
| Confirm | `Enter` |
| Cancel | `Esc` |

## Modes

### ● FULL — Auto-inject (~14K tokens/turn)

Like pi-memory. Before every turn, automatically searches QMD and injects results into the system prompt. Most context, highest token cost.

### ◐ HYBRID — On-demand (~100B tokens/turn) ← default

Registers the `recall` tool and adds a light hint to the system prompt. Agent searches only when it needs to. Best balance of context and token efficiency.

### ○ NONE — No context (0 tokens/turn)

No injection, no hint. The `recall` tool still exists but returns a "disabled" message. Maximum token savings.

## The `recall` Tool

Available in FULL and HYBRID modes (returns disabled message in NONE).

```
recall({ query: "auth decision", mode: "keyword" })
recall({ query: "why did we choose postgresql", mode: "semantic" })
recall({ query: "database migration plan", mode: "deep", limit: 10 })
```

| Mode | Speed | Method |
|---|---|---|
| `keyword` | ~30ms | BM25 full-text |
| `semantic` | ~2s | Vector similarity |
| `deep` | ~10s | Hybrid + LLM reranking |

## State

Current mode is saved to `~/.pi/agent/qmd-smart-state.json` and persists across restarts.

## Requirements

- [QMD](https://github.com/tobi/qmd) must be installed for search to work
- Extension still functions without QMD (mode selector works, search returns install instructions)

## Comparison with pi-memory

| | pi-memory | qmd-smart |
|---|---|---|
| Auto-inject | Always on | Toggleable (full/hybrid/none) |
| Token control | No | Yes — 3 modes |
| Memory write | ✅ | ❌ (use pi-memory for that) |
| Scratchpad | ✅ | ❌ |
| Session handoff | ✅ | ❌ |
| recall tool | ❌ | ✅ |
| Mode selector UI | ❌ | ✅ |

**Tip:** Use both! Install pi-memory for write/scratchpad/handoff, and qmd-smart for controlled injection. Set pi-memory's `PI_MEMORY_NO_SEARCH=1` to disable its auto-inject, then use qmd-smart's modes to control when QMD runs.
