# ClawFlow Design Document

**Date**: 2026-02-24
**Status**: Approved

## Overview

ClawFlow is an Electron desktop app that acts as an autonomous development pipeline engine. It moves tasks through stages by launching Claude Agent SDK sessions with stage-specific prompt templates. Tasks persist in per-project SQLite databases with full agent audit trails. It wraps existing superpowers skills without modifying them — ClawFlow knows the right order and enforces it.

## Architecture

Three-layer Electron app:

- **Renderer** (React + Zustand): Dashboard, kanban board, task detail, intervention panel, activity feed
- **Main Process**: Pipeline engine (state machine), SDK manager (Claude Agent SDK), DB manager (better-sqlite3), template engine (prompt construction)
- **Data Layer**: `~/.clawflow/dbs/{project}.db` per project, `~/.clawflow/clawflow.db` global projects registry, `{project}/.clawflow/project.json` per-project config

## Pipeline Stages & Complexity Tiers

Three tiers control which stages run:

| Tier | Flow | Use Case |
|------|------|----------|
| L1 Quick | Plan → Implement → Done | Typos, config changes, single-line fixes |
| L2 Standard | Brainstorm → Plan → Implement (TDD) → Verify → Done | Bug fixes, small features |
| L3 Full | Brainstorm → Design Review → Plan → Implement (TDD) → Code Review → Verify → Done | New features, architecture changes |

### Stage → Skill Mapping

| Stage | Skill Invoked | Agent Model | Pauses? |
|-------|--------------|-------------|---------|
| Brainstorm | `brainstorming` | Opus | Yes — needs human input |
| Design Review | `design-review` (agent team) | Opus | Yes — presents verdict |
| Plan | `writing-plans` | Opus | Yes (default) / Auto-approve if score >= 4 |
| Implement | `test-driven-development` + `subagent-driven-development` | Opus | No — runs to completion |
| Code Review | `requesting-code-review` | Sonnet | Yes (default) / Auto-approve if avg >= 4 |
| Verify | `verification-before-completion` | Sonnet | No — pass/fail is automatic |
| Done | `finishing-a-development-branch` | Sonnet | Yes — merge/PR/cleanup decision |

### Circuit Breakers

If Plan or Code Review rejects 3 times consecutively, the pipeline halts and opens the intervention panel. In auto mode, this is the only forced human checkpoint.

## Data Model

### Tasks Table (per-project DB)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | INTEGER PK | Auto-incrementing task ID |
| `title` | TEXT | Short task title |
| `description` | TEXT | Full requirements/context |
| `tier` | TEXT | `L1` / `L2` / `L3` |
| `status` | TEXT | Current pipeline stage |
| `priority` | TEXT | `low` / `medium` / `high` / `critical` |
| `auto_mode` | BOOLEAN | Whether this task runs fully autonomous |
| `created_at` | TEXT | ISO-8601 |
| `started_at` | TEXT | When pipeline began |
| `completed_at` | TEXT | When task reached Done |
| `current_agent` | TEXT | Which agent is currently working |
| `brainstorm_output` | TEXT | Design doc from brainstorming |
| `design_review` | JSON | Verdict + comments from review team |
| `plan` | JSON | Numbered task breakdown |
| `plan_review_count` | INTEGER | Rejection iterations (circuit breaker) |
| `implementation_notes` | JSON | Agent work log during implementation |
| `review_comments` | JSON | Code review feedback + scores |
| `review_score` | REAL | Average review score |
| `impl_review_count` | INTEGER | Code review rejection iterations |
| `test_results` | JSON | Pass/fail, counts, lint/build/test |
| `verify_result` | TEXT | `pass` / `fail` + evidence |
| `commit_hash` | TEXT | Git commit SHA on completion |
| `handoff` | JSON | Handoff chain — each stage's handoff block |
| `agent_log` | JSON | Full audit trail with timestamps + signatures |

Allowed status values: `backlog` → `brainstorming` → `design_review` → `planning` → `implementing` → `code_review` → `verifying` → `done` / `blocked`

### Projects Table (global DB)

| Column | Type | Purpose |
|--------|------|---------|
| `name` | TEXT PK | Project identifier |
| `path` | TEXT | Filesystem path to project |
| `db_path` | TEXT | Path to project's SQLite DB |
| `created_at` | TEXT | When registered |
| `last_opened` | TEXT | For recent projects sorting |

### Agent Signatures

Every write to a JSON field includes a signature header:
```
> **Planner** `opus` · 2026-02-24T15:30:00Z
```

### Database Configuration

- One SQLite DB per project at `~/.clawflow/dbs/{project-name}.db`
- DELETE journal mode (OneDrive sync safety)
- Global projects registry at `~/.clawflow/clawflow.db`

## SDK Integration & Agent Dispatch

### 1. Template Construction

Each stage has a prompt template in `src/templates/`. The engine fills placeholders with task data (title, description, outputs from previous stages, handoff context).

### 2. SDK Session Launch

Main process calls Claude Agent SDK with:
- Constructed prompt from template
- Model assignment per stage config
- Max turns limit to prevent runaway
- Working directory set to project path
- Claude inherits `~/.claude/` config, so all existing skills are available

### 3. Streaming & Storage

As SDK streams responses:
- UI gets live updates via IPC (activity feed)
- Agent log appends with timestamps
- Structured output (JSON) is parsed and stored in appropriate DB columns

### 4. Tool Approval Routing

- **Auto mode**: All tool uses approved automatically
- **Gated mode**: Destructive operations (file writes, git, bash) routed to UI as approval requests. Non-destructive reads/searches auto-approved.

### 5. Stage Completion

When SDK session ends, engine:
1. Parses final output for structured data (scores, verdicts, pass/fail)
2. Updates task record in SQLite
3. Evaluates transition rules (score thresholds, circuit breaker counts)
4. Advances to next stage or pauses for human input

## Handoff Protocol

Every agent template has a mandatory handoff block appended (from `_handoff.md`):

```markdown
### HANDOFF
- **Status**: [completed | blocked | needs_intervention]
- **Summary**: [2-3 sentence summary of what was done]
- **Key Decisions**: [decisions made and why]
- **Open Questions**: [anything unresolved, or "none"]
- **Files Modified**: [list of files touched, or "none"]
- **Next Stage Needs**: [what the next agent needs to know]
- **Warnings**: [gotchas, risks, or concerns for downstream agents]
```

ClawFlow parses this block and:
1. Stores it in the `handoff` JSON column as part of the chain
2. Injects it into the next stage's template as context
3. Uses `Status: blocked` to halt the pipeline
4. Flags non-empty `Open Questions` in auto mode for human input
5. Surfaces `Warnings` in the UI with alert badges

## UI Design

### Project Selector (launch screen)
- Registered projects sorted by `last_opened`
- "Register Project" button (folder picker)
- Project cards: name, path, task counts by status, last activity

### Dashboard (main view)
- **Top bar**: Project name, quick-add task, settings
- **Metrics row**: Tasks in-flight, completion rate, average review score, circuit breaker trips
- **Kanban board**: Columns per active stage. Task cards show title, tier badge, priority color, current agent (pulsing when active), time-in-stage
- **Activity feed** (right sidebar, collapsible): Real-time agent actions across all tasks, timestamped, color-coded, clickable

### Task Detail (click a card)
- Header: title, tier, priority, status, auto/gated badge
- Timeline: visual stage progression with timestamps and durations
- Stage tabs: click any completed stage for full agent output, handoff, scores
- Handoff chain: collapsible accordion of all stage handoffs
- Agent log: full raw audit trail
- Intervention panel: appears when paused

### Intervention Panel (inline in task detail)
- Plan review gate: plan display, approve/reject, feedback field
- Code review gate: scores, comments, approve/reject/discuss
- Circuit breaker: rejection history, retry/change approach/override options
- Open questions: agent's questions with response field

### Design Language
- Dark theme, Tokyo Night-inspired palette
- Minimal chrome, board and detail do the heavy lifting
- Monospace for agent output, Inter for UI text
- Subtle transitions only

## Project Structure

```
ClawFlow/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── src/
│   ├── main/
│   │   ├── index.ts                    # Electron main, window, IPC
│   │   ├── pipeline-engine.ts          # State machine, transitions, circuit breakers
│   │   ├── sdk-manager.ts              # Claude Agent SDK wrapper
│   │   ├── db.ts                       # SQLite operations
│   │   ├── template-engine.ts          # Template loading, placeholder filling, handoff append
│   │   └── ipc-handlers.ts             # IPC channel definitions
│   ├── preload/
│   │   └── index.ts                    # contextBridge typed window.api
│   ├── shared/
│   │   ├── types.ts                    # Task, Project, Handoff, PipelineStage, ReviewScore
│   │   ├── constants.ts                # Stage configs, tier definitions, thresholds
│   │   └── pipeline-rules.ts           # Transition rules, tier→stage mappings, circuit breaker limits
│   └── renderer/
│       ├── App.tsx                     # Root routing
│       ├── theme.ts                    # Color tokens, fonts
│       ├── stores/
│       │   ├── projectStore.ts         # Projects
│       │   ├── taskStore.ts            # Tasks, filtering, sorting
│       │   ├── pipelineStore.ts        # Active pipeline state, streaming
│       │   └── layoutStore.ts          # View state
│       └── components/
│           ├── ProjectSelector/
│           ├── Dashboard/
│           ├── KanbanBoard/
│           ├── TaskDetail/
│           ├── InterventionPanel/
│           ├── ActivityFeed/
│           └── common/
├── src/templates/
│   ├── brainstorm-agent.md
│   ├── plan-agent.md
│   ├── implement-agent.md
│   ├── code-review-agent.md
│   ├── verify-agent.md
│   ├── completion-agent.md
│   └── _handoff.md                    # Appended to all templates
└── data/                              # Gitignored — local dev databases
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Electron 40 |
| Frontend | React 19 + TypeScript |
| Build | electron-vite + Vite |
| Styling | TailwindCSS v4 |
| State | Zustand |
| Database | better-sqlite3 (SQLite) |
| AI | @anthropic-ai/claude-agent-sdk |
| IPC | Electron contextBridge |
| Package manager | pnpm |

## Scope Boundaries (What ClawFlow Is NOT)

- **Not an IDE** — no file tree, no editor, no terminal
- **Not a Claude Code replacement** — uses SDK directly; CLI still available for ad-hoc work
- **Not a skill reimplementation** — invokes existing skills via templates, doesn't contain skill logic
- **Not a chat app** — intervention panel handles gates, no free-form conversation
- **Not multi-user** — single user, local machine, no auth/server/collaboration
