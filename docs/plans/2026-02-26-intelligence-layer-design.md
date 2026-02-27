# ClawFlow Intelligence Layer — Design Document

**Date:** 2026-02-26
**Status:** Draft
**Scope:** Domain Knowledge Store, FDRL, Validation Hooks, Two-Strike Intelligence, Skills System, Auto-Merge

---

## Overview

The Intelligence Layer is a unified system that makes ClawFlow's pipeline and workshop progressively smarter. It connects six features into a single data flow:

```
Rejection/Failure → FDRL captures lesson → Domain Knowledge stores it →
Summary index injected into agents → Agents fetch full entries via tool →
Validation hooks verify agents applied the lessons →
Skills guide agent behavior per stage → Auto-merge completes the loop
```

### Design Principles

- **Token-aware**: Every injection has a budget. Summary indexes over full content. Tiered skill injection.
- **Local storage**: All data in SQLite (per-project + global). No external repos.
- **Human-in-the-loop**: Candidates require promotion. Circuit breakers force review.
- **Workshop edits, pipeline reads**: Workshop agents can modify knowledge and skills. Pipeline agents are read-only consumers.

---

## 1. Domain Knowledge Store

### Purpose

Persistent project-specific and global knowledge that agents reference across sessions. Replaces the need to re-explain domain quirks, business rules, and architectural decisions every time.

### Database Schema

**Per-project table** (`domain_knowledge` in project DB):

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| key | TEXT NOT NULL | Short identifier: `"api-date-format"`, `"auth-flow-quirk"` |
| summary | TEXT NOT NULL | One-line description (~10-20 words) for the index |
| content | TEXT NOT NULL | Full knowledge entry (markdown) |
| category | TEXT NOT NULL | `business_rule` \| `architecture` \| `api_quirk` \| `lesson_learned` \| `convention` |
| tags | TEXT DEFAULT '[]' | JSON string array for relevance matching |
| source | TEXT NOT NULL | `workshop` \| `pipeline` \| `manual` \| `fdrl` |
| source_id | TEXT | Session or task ID that created it |
| status | TEXT DEFAULT 'active' | `candidate` \| `active` \| `archived` |
| token_estimate | INTEGER | Rough token count of content (chars / 4) |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

**Global table** (`global_knowledge` in `clawflow.db`): Same schema for cross-project lessons.

### Summary Index

A function `buildKnowledgeIndex(projectDb, globalDb)` produces a compact string injected into every agent prompt:

```markdown
## Domain Knowledge Index
Project-specific: 12 entries | Global: 5 entries

### Project Knowledge
- [api-date-format] API returns epoch timestamps, not ISO-8601
- [auth-requires-refresh] Auth tokens expire every 15min, must refresh
- [db-cascade-delete] User deletion cascades to all related records

### Global Knowledge
- [null-check-arrays] Always null-check before .map/.filter on API responses
- [git-worktree-cleanup] Worktrees must be removed before branch deletion

Use fetch_knowledge(key_or_id) to read full details on any entry.
```

**Token budget**: ~50-100 tokens per entry in summary form. With 20 project + 10 global entries: ~1,500-3,000 tokens.

### Agent Tools

**All agents** (pipeline + workshop):
- `fetch_knowledge(key_or_id)` — returns full content of a knowledge entry
- `save_knowledge(key, summary, content, category, tags[])` — creates entry (`active` from workshop, `candidate` from pipeline/FDRL)

**Workshop agents only** (additionally):
- `update_knowledge(id, content?, summary?, tags?)` — edit an existing entry
- `list_knowledge(category?)` — browse entries beyond the summary index

**Pipeline agents**: Read-only. Cannot call `update_knowledge` or `list_knowledge`. Can only `fetch_knowledge` and `save_knowledge` (as candidate).

### Injection Point

In `TemplateEngine.constructPrompt()`, after skill content is appended, prepend the knowledge index:

```ts
const index = buildKnowledgeIndex(projectDb, globalDb)
prompt = `${index}\n\n${prompt}`
```

---

## 2. Failure-Driven Rule Learning (FDRL)

### Purpose

Automatically capture lessons from failures and rejections. Human-reviewed before promotion to active knowledge. Integrates with TDD — recurring test failures become documented patterns.

### Capture Triggers

**Trigger 1: Stage Rejection**
When `rejectStage(taskId, feedback)` is called:
1. Save `feedback` as a `candidate` knowledge entry
2. Key: auto-generated from task title + stage (e.g., `"auth-fix-plan-rejection-1"`)
3. Summary: first sentence of feedback
4. Category: `lesson_learned`, source: `fdrl`, source_id: taskId
5. Tags: current stage name + task title keywords

**Trigger 2: Circuit Breaker**
When `circuit-breaker` event fires:
1. Surface all `candidate` entries for this task in the InterventionPanel
2. New "Lessons Learned" section below the circuit breaker UI
3. Per candidate: **Confirm** (→ `active`), **Edit** (inline editor → `active`), **Discard** (→ `archived`)
4. Option to write a new lesson from scratch
5. Checkbox: "Apply to all projects?" → copies to `global_knowledge`

**Trigger 3: Workshop Discovery**
Workshop agent calls `save_knowledge()` → entry created as `active` immediately (workshop is human-supervised).

**Trigger 4: Pipeline Agent Discovery**
Pipeline agent calls `save_knowledge()` during implementation → saved as `candidate`. Surfaces at next gate stage review or task completion.

### TDD Integration

- Repeated test failures leading to rejection become candidate lessons
- Promoted lessons appear in future implement stages via the knowledge index
- TDD skill core includes: *"Check domain knowledge before writing tests — existing lessons may inform your test cases"*

### Candidate Review Points

1. **InterventionPanel** (circuit breaker) — primary review
2. **Task completion** — when task reaches `done`, remaining candidates for that task shown in a review prompt before archiving

### Promotion to Global

When confirming a lesson, checkbox: "Apply to all projects?" If checked, entry is copied to `global_knowledge` in `clawflow.db`.

---

## 3. Pipeline Validation Hooks

### Purpose

Configurable shell commands that run at stage boundaries. Quality gates that block stage transitions on failure. Replaces the `.claude/hooks` system that doesn't transfer to ClawFlow's SDK-based agents.

### Configuration

Settings keys:
- `pipeline.hooks.post.<stage>` — commands after stage completion
- `pipeline.hooks.pre.<stage>` — commands before stage start
- `pipeline.hooks.presets` — named preset bundles

Each hook value is a JSON array:

```json
[
  {
    "name": "TypeScript Check",
    "command": "npx tsc --noEmit",
    "cwd": "{{project_path}}",
    "timeout": 30000,
    "required": true
  },
  {
    "name": "ESLint",
    "command": "npx eslint src/ --quiet",
    "cwd": "{{project_path}}",
    "timeout": 60000,
    "required": false
  }
]
```

- `required: true` — failure blocks stage transition
- `required: false` — failure logged as warning, doesn't block

### Execution

Two new methods in `PipelineEngine`:

- **`runPreHooks(taskId, stage)`** — at top of `runStage()`, before SDK call. Required hook failure → stage doesn't start.
- **`runPostHooks(taskId, stage)`** — after SDK returns, before transition. Required hook failure → treated as rejection with hook output as feedback.

Hooks run in the **task's worktree directory**, validating the task's actual code.

### Built-in Presets

| Preset | Hooks |
|--------|-------|
| TypeScript | `post.implement`: `npx tsc --noEmit` |
| Full JS | `post.implement`: `tsc --noEmit` + `eslint`, `post.code_review`: `npm test` |
| Python | `post.implement`: `python -m py_compile`, `post.code_review`: `pytest` |

### Settings UI

New "Validation Hooks" section in Settings modal under project tab:
- Preset selector dropdown
- Custom hooks list with add/edit/delete
- Per-hook: name, command, stage trigger (pre/post + stage), required toggle, timeout

### FDRL Connection

When a required hook fails:
1. Failure output recorded as rejection feedback
2. FDRL captures it as a `candidate` lesson
3. If same hook fails 3+ times across different tasks, FDRL auto-suggests promoting pattern to global knowledge

---

## 4. Two-Strike Intelligence

### Purpose

Make rejections smarter before the circuit breaker fires. Detect repeated failure patterns and force the agent to reconsider its approach after 2 similar rejections.

### Current Behavior

Circuit breaker fires after 3 rejections (count-based, no pattern analysis).

### Enhancement

New function `detectRepeatedFailure(taskId, stage, feedback)` in `PipelineEngine`:

1. After each rejection, compare current feedback with previous rejection feedback for same stage
2. Similarity heuristic: extract error messages, file paths, key nouns. If >50% match → "similar"
3. On **second** consecutive similar rejection, inject addendum before retry:

```markdown
## Two-Strike Protocol

Your previous two attempts at this stage were rejected for similar reasons:
- Attempt 1: {{rejection_1_summary}}
- Attempt 2: {{rejection_2_summary}}

Before proceeding, you MUST:
1. Explain why your previous approach failed
2. List 3 fundamentally different strategies to solve this
3. Choose the best strategy and explain why
4. Only then proceed with implementation
```

4. Fires at strike 2, giving agent one intelligent attempt before circuit breaker at strike 3

### Similarity Detection

Simple string matching (no ML):
- Extract error messages, file paths, key nouns from feedback
- >50% term overlap between consecutive rejections → "similar"
- False positives only add extra guidance (not harmful)

### No New UI

Purely a pipeline-engine enhancement. InterventionPanel already handles circuit breaker at strike 3.

---

## 5. ClawFlow Skills System

### Purpose

ClawFlow-native skills library — purpose-built versions of global `.claude` workflow skills, optimized for ClawFlow's pipeline and workshop. Two-tier injection for token efficiency.

### Storage

Skills live at `~/.clawflow/skills/<skill-name>/`:

```
~/.clawflow/skills/
├── brainstorming/
│   ├── core.md          -- always injected (~200-500 tokens)
│   └── extended.md      -- on-demand via tool (~1000-3000 tokens)
├── test-driven-development/
│   ├── core.md
│   └── extended.md
├── writing-plans/
│   ├── core.md
│   └── extended.md
├── design-review/
│   ├── core.md
│   └── extended.md
├── code-review/
│   ├── core.md
│   └── extended.md
├── verification/
│   ├── core.md
│   └── extended.md
└── completion/
    ├── core.md
    └── extended.md
```

### Tier Structure

**`core.md`** (~200-500 tokens): Essential rules, constraints, "what to do." Always injected into agent prompt.

**`extended.md`** (~1,000-3,000 tokens): Examples, edge cases, detailed workflows, checklists. Available on-demand via `fetch_skill_detail(skill_name)` tool.

### First-Run Seeding

On first launch (or when `~/.clawflow/skills/` doesn't exist):
1. ClawFlow checks for default skills in `src/skills/defaults/`
2. Copies them to `~/.clawflow/skills/`
3. These become the editable baseline

### Stage-to-Skill Mapping

Formalized in `PipelineEngine`:

```ts
const STAGE_SKILL_MAP: Record<Stage, string> = {
  brainstorm: 'brainstorming',
  design_review: 'design-review',
  plan: 'writing-plans',
  implement: 'test-driven-development',
  code_review: 'code-review',
  verify: 'verification',
  done: 'completion'
}
```

Per-project override via settings: `pipeline.skill.<stage>` can point to a different skill name.

### Injection Flow

In `TemplateEngine.constructPrompt()`:
1. Look up skill for current stage via `STAGE_SKILL_MAP` (or project override)
2. Load `core.md` from `~/.clawflow/skills/<skill>/core.md`
3. Inject as `## Skill: <name> (Core Instructions)`
4. Agent also receives `fetch_skill_detail` tool for extended content

### Agent Tools

**All agents**:
- `fetch_skill_detail(skill_name)` — returns `extended.md` content

**Workshop agents only** (additionally):
- `edit_skill(skill_name, tier, content)` — overwrites `core.md` or `extended.md`
- `view_skill(skill_name, tier?)` — reads current skill content

**Pipeline agents**: Read-only. Can fetch extended content but cannot edit skills.

### Workshop Skill Integration

Workshop agent system prompt includes:
```markdown
You have access to ClawFlow skills. Use fetch_skill_detail() to load
extended guidance when exploring a topic in depth. Use edit_skill()
when the user wants to modify how a skill works.
```

### Token Budget Summary

Per agent call baseline:
- Knowledge index: ~1,500-3,000 tokens
- Skill core: ~200-500 tokens
- Template + handoffs: ~1,000-2,000 tokens
- **Total overhead: ~3,000-5,500 tokens** (<5% of 128K context)

Extended content fetched on-demand only — doesn't add to baseline.

---

## 6. Auto-Merge on Task Completion

### Purpose

Remove the merge decision from agents. Every completed task auto-merges its worktree branch to the base branch. Eliminates the circuit breaker bug where agent merge questions get misinterpreted as rejections.

### Flow

After `done` stage completes successfully:
1. `PipelineEngine` calls `GitEngine.mergeWorktree(taskId)`
2. Merges task's worktree branch into project's base branch (configurable, default `main`)
3. Cleans up worktree directory
4. Records merge commit hash on task record
5. Emits `task:merged` event to UI

### Edge Cases

**Merge conflicts**: Set task status to `blocked`, `pause_reason: 'merge_conflict'`. Surface in InterventionPanel with conflict details. User resolves manually, clicks "Retry Merge."

**Multiple tasks merging**: Sequential merge (not parallel) to avoid conflicts between concurrent tasks.

**Skip merge**: Per-task toggle `auto_merge: boolean` (default `true`). If `false`, branch stays for manual handling (e.g., user wants to create a PR instead).

### Completion Skill Update

The `completion` skill (`~/.clawflow/skills/completion/core.md`) is rewritten to:
- Summarize what was done
- Confirm all tests pass
- Do NOT ask about merging — pipeline handles it
- Report final status

---

## Integration Map

### Data Flow Between Features

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Prompt Construction                │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Knowledge    │  │  Skill Core  │  │  Template +      │  │
│  │  Index        │  │  (~300 tok)  │  │  Handoffs        │  │
│  │  (~2000 tok)  │  │              │  │  (~1500 tok)     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘  │
│         └──────────────────┼─────────────────┘              │
│                            ▼                                │
│                    Agent Execution                          │
│                            │                                │
│              ┌─────────────┼─────────────┐                  │
│              ▼             ▼             ▼                  │
│     fetch_knowledge  fetch_skill   save_knowledge           │
│     (on-demand)      (on-demand)   (creates candidate)      │
│                                         │                   │
└─────────────────────────────────────────┼───────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Stage Boundary                           │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Pre-Hooks   │  │  Post-Hooks  │  │  FDRL Capture    │  │
│  │  (validate   │  │  (validate   │  │  (on rejection   │  │
│  │   before)    │  │   after)     │  │   or hook fail)  │  │
│  └──────────────┘  └──────────────┘  └──────┬───────────┘  │
│                                              │              │
│                    Two-Strike                │              │
│                    Detection                 │              │
│                    (on 2nd similar           │              │
│                     rejection)              ▼              │
│                                     ┌──────────────────┐   │
│                                     │  Candidate Pool  │   │
│                                     │  (reviewed at    │   │
│                                     │   circuit breaker│   │
│                                     │   or completion) │   │
│                                     └──────┬───────────┘   │
│                                            │               │
└────────────────────────────────────────────┼───────────────┘
                                             │
                          ┌──────────────────┼──────────────┐
                          ▼                  ▼              ▼
                   Promote to         Promote to      Discard
                   Project KB         Global KB
```

### Modified Files (Existing)

| File | Changes |
|------|---------|
| `src/main/pipeline-engine.ts` | Pre/post hooks, FDRL capture, two-strike detection, auto-merge call |
| `src/main/template-engine.ts` | Knowledge index injection, tiered skill loading |
| `src/main/workshop-engine.ts` | New tools: save/update/list knowledge, edit/view skill, fetch_skill_detail |
| `src/main/sdk-manager.ts` | New tools for pipeline agents: fetch_knowledge, save_knowledge, fetch_skill_detail |
| `src/main/git-engine.ts` | New `mergeWorktree(taskId)` method |
| `src/main/db.ts` | New `domain_knowledge` table, `global_knowledge` table, migration |
| `src/main/index.ts` | IPC handlers for knowledge CRUD, skill CRUD, hook management |
| `src/shared/settings.ts` | New hook and skill setting keys |
| `src/renderer/src/stores/` | New `knowledgeStore.ts`, updates to `pipelineStore`, `settingsStore` |
| `src/renderer/src/components/` | InterventionPanel FDRL section, Settings hooks section |
| `src/templates/*.md` | Add `{{domain_knowledge}}` variable, update skill references |

### New Files

| File | Purpose |
|------|---------|
| `src/main/knowledge-engine.ts` | Knowledge CRUD, index builder, FDRL capture logic |
| `src/main/hook-runner.ts` | Shell command execution for validation hooks |
| `src/main/skill-loader.ts` | Tiered skill loading, first-run seeding |
| `src/skills/defaults/*/core.md` | Default skill core files (shipped with app) |
| `src/skills/defaults/*/extended.md` | Default skill extended files |
| `src/shared/knowledge-types.ts` | Knowledge entry types, categories, status enum |
| `src/shared/hook-types.ts` | Hook configuration types |
| `src/renderer/src/stores/knowledgeStore.ts` | Knowledge state management |
| `src/renderer/src/components/Knowledge/` | Knowledge management UI components |

---

## Token Budget Summary

| Component | Tokens | When |
|-----------|--------|------|
| Knowledge summary index | ~1,500-3,000 | Always (scales with entries) |
| Skill core | ~200-500 | Always (per stage) |
| Template + handoffs | ~1,000-2,000 | Always |
| **Baseline total** | **~3,000-5,500** | **Every agent call** |
| Knowledge full entry | ~200-1,000 | On-demand (fetch_knowledge) |
| Skill extended | ~1,000-3,000 | On-demand (fetch_skill_detail) |
| Two-strike addendum | ~200 | Only on 2nd similar rejection |

Baseline is <5% of 128K context window. On-demand content only loaded when agents need it.

---

## Out of Scope

- Mobile/remote Workshop access (future)
- ML-based similarity detection for two-strike (simple heuristic is sufficient)
- Automatic skill generation from conversation patterns
- Knowledge sharing between users/machines
- Git repo-based knowledge sync
