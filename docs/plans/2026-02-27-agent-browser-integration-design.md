# Agent-Browser Integration Design

**Date:** 2026-02-27
**Status:** Approved
**Approach:** Template-only (Approach A)

## Overview

Integrate [agent-browser](https://github.com/vercel-labs/agent-browser) — a headless browser automation CLI — into ClawFlow by adding usage instructions to agent templates. Sub-agents and the workshop agent gain browser capabilities through the existing Bash tool with zero code changes.

## Goals

- Enable **visual verification** of UI work after implementation
- Enable **interactive testing** of user flows (click, type, navigate)
- Enable **research & reference** browsing during design/implementation
- Enable **accessibility auditing** via accessibility tree snapshots
- Maintain **zero new code dependencies** — template/prompt changes only

## Architecture Decision

**Approach A: Template-Only Integration** was chosen over:
- **Approach B (Template + Helper Script):** Adds maintenance burden for marginal benefit
- **Approach C (Template + Pipeline Middleware):** Too risky during active orchestrator development

`agent-browser` is installed globally on the system. Sub-agents call it via the existing `Bash` tool. No new tool registration, no MCP server, no code changes to pipeline or SDK manager.

## Templates to Update

All 9 agent templates receive a `## Browser Automation` section:

| Template | Commands | Focus |
|----------|----------|-------|
| `workshop-agent.md` | `open`, `snapshot`, `screenshot` | Research: browse docs, check competitor UIs, capture references for design artifacts |
| `brainstorm-agent.md` | `open`, `snapshot` | Research: look up patterns, prior art, API docs |
| `plan-agent.md` | `open`, `snapshot` | Feasibility: browse API docs, check library compatibility |
| `design-review-agent.md` | `open`, `snapshot`, `screenshot` | Standards: check industry patterns, compare against guidelines |
| `implement-agent.md` | `open`, `snapshot` | Reference: look up framework docs, MDN, API references |
| `grouped-implement-agent.md` | `open`, `snapshot` | Same as implement |
| `code-review-agent.md` | `open`, `snapshot`, `screenshot`, `click`, `type` | Review: verify UI matches design, check interactive elements, audit a11y |
| `verify-agent.md` | Full command set | Testing: screenshots, user flow walkthroughs, a11y audits, interactive testing |
| `completion-agent.md` | `open`, `screenshot`, `snapshot` | Final check: visual confirmation of delivered work |

## Instruction Block Structure

Each template gets a standardized section:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI for web interaction.
Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree (use for a11y checks)
- `agent-browser screenshot --path <file>` — Capture page screenshot
- `agent-browser click @<ref>` — Click element by accessibility ref
- `agent-browser type @<ref> "text"` — Type into input field
- `agent-browser scroll down 500` — Scroll the page
- `agent-browser execute "document.title"` — Run JavaScript
- `agent-browser close` — Close the browser (ALWAYS do this when done)

### When to Use
[Stage-specific guidance]

### When NOT to Use
[Stage-specific anti-patterns]

### Rules
- ALWAYS close the browser when done
- One browser session at a time
- Don't browse sites requiring authentication unless the task involves it
- Don't submit forms on production sites
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output is verbose
```

Commands are filtered per template. Verify-agent gets the full set; lighter stages get a subset.

## Workshop Agent Integration

### THINK Phase
The workshop agent can browse during design sessions:
- Research reference sites to inform design decisions
- Screenshot competitor UIs and reference them in design artifacts
- Check API documentation to validate feasibility before task creation

### EXECUTE Phase (Orchestrating Groups)
The workshop can include browser-based verification in work orders:
```
tests:
  - "Screenshot the login page and verify it matches the design"
  - "Use agent-browser snapshot to verify form inputs have proper ARIA labels"
  - "Navigate the signup flow end-to-end using agent-browser"
```

## Safety Guardrails (Prompt-Level)

1. **Resource cleanup** — Always `agent-browser close` when done. Hard rule in every template.
2. **Scope limits** — No authenticated sites unless task requires it. No form submissions on production.
3. **Token awareness** — Use `snapshot` sparingly. Prefer targeted element inspection over full page dumps.
4. **No parallel browsers** — One session per agent to avoid resource contention with Electron.
5. **Timeout guidance** — If page doesn't load in 10 seconds, move on.

All guardrails are prompt-enforced. No code enforcement needed for this approach. If agents violate guardrails, instructions can be tightened or the approach can be escalated to Approach B (helper scripts).

## What This Does NOT Include

- No MCP server wrapper
- No helper scripts
- No changes to `pipeline-engine.ts`, `sdk-manager.ts`, or `workshop-engine.ts`
- No new IPC handlers
- No new database tables
- No new dependencies in `package.json`

## Future Enhancements (Out of Scope)

If the template-only approach proves insufficient:
- **Approach B:** Add `scripts/browser-tools.sh` with standardized workflows (`verify-visual`, `check-a11y`)
- **Approach C:** Add pipeline middleware for automatic screenshot capture at stage transitions
- **MCP server:** Build a typed tool interface for cleaner agent interactions
