# Pi-QMD-smart

⚡ Unified memory control panel for pi — toggle all memory extensions from one UI.

## Install

```bash
pi install /Users/madearga/pi-extensions/qmd-smart
```

Then reload: `/reload`

## Usage

| Action | How |
|---|---|
| Open control panel | `Ctrl+Alt+M` or `/qmd` or `/memory` |
| Navigate | `↑` `↓` |
| Toggle item | `Enter` or `Tab` |
| Quick toggle | `1` (QMD) `2` (Self-Learning) `3` (Pi-Memory) |
| QMD quick mode | `F` (full) `H` (hybrid) `N` (none) |
| Toggle all on/off | `A` |
| Save & close | `S` |
| Cancel | `Esc` |

## Control Panel UI

```
  ⚡  Memory Control Panel
  ──────────────────────────────────────────────────────────

 ❯  ✓  🔍  QMD Search
           Search past context via QMD (keyword/semantic/deep)
           Mode: ◐ HYBRID  (~100B/turn)  ✅

    ✓  🧠  Self-Learning
           Auto-reflect after tasks, learn from mistakes
           ● ON  (active)

    ✓  📝  Pi-Memory
           Inject MEMORY.md, scratchpad, daily logs
           ● ON  (active)

  ──────────────────────────────────────────────────────────
  💰  Est. injection: ~14K/turn
  ──────────────────────────────────────────────────────────
  ↑↓ Nav  Enter/Tab Toggle  1/2/3 Quick  A All  S Save  Esc Cancel
  F Full  H Hybrid  N None (QMD quick)
```

## What It Controls

### 1. QMD Search (🔍)

| Mode | Token Cost | Behavior |
|---|---|---|
| **FULL** | ~14K/turn | Auto-search QMD every turn + inject results |
| **HYBRID** | ~100B/turn | `recall` tool available, agent searches when needed |
| **NONE** | 0/turn | No search, no hint, `recall` returns "disabled" |

### 2. Self-Learning (🧠)

Controls [pi-self-learning](https://www.npmjs.com/package/pi-self-learning):

| State | Behavior |
|---|---|
| **ON** | Auto-reflect after tasks, CORE.md injected (~4K/turn) |
| **OFF** | Suppresses reflection + context injection |

### 3. Pi-Memory (📝)

Controls [pi-memory](https://github.com/jayzeng/pi-memory):

| State | Behavior |
|---|---|
| **ON** | MEMORY.md + scratchpad + daily logs injected (~10K/turn) |
| **OFF** | Suppresses context injection via `PI_MEMORY_NO_SEARCH=1` |

## The `recall` Tool

Available in FULL and HYBRID modes (returns disabled message in NONE).

```
recall({ query: "auth decision", mode: "keyword" })
recall({ query: "why postgresql", mode: "semantic" })
recall({ query: "migration plan", mode: "deep", limit: 10 })
```

| Mode | Speed | Method |
|---|---|---|
| `keyword` | ~30ms | BM25 full-text |
| `semantic` | ~2s | Vector similarity |
| `deep` | ~10s | Hybrid + LLM reranking |

## State

Saved to `~/.pi/agent/qmd-smart-state.json`, persists across restarts.

## Recommended Setup

```bash
# Install all three extensions
pi install npm:pi-self-learning
pi install npm:pi-memory
pi install /Users/madearga/pi-extensions/qmd-smart

# Then use Ctrl+Alt+M to control everything from one panel
```

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+Alt+M` | Open control panel |
| `/qmd` | Open control panel (command) |
| `/memory` | Open control panel (command) |
| `↑` `↓` | Navigate between items |
| `Enter` / `Tab` | Toggle selected item |
| `1` `2` `3` | Quick toggle items |
| `F` / `H` / `N` | QMD mode: Full / Hybrid / None |
| `A` | Toggle all on/off |
| `S` | Save & close |
| `Esc` | Cancel (revert changes) |

## License

MIT
