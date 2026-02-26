# Pipeline Orchestration Fix — Design Doc

> **Date:** 2026-02-26
> **Status:** Approved
> **Scope:** Fix design review stage hang; enable reliable team orchestration in pipeline

## Problem

The design review stage (L3 tasks) hangs indefinitely. The stage's skill instructs the agent to spawn a two-agent team (Architect + Advocate) using Claude Code orchestration tools (`TeamCreate`, `Task`, `SendMessage`). Three compounding issues cause the hang:

1. **Tool approval hang:** Orchestration tools aren't in the auto-approve list, so they trigger a `pendingApprovals` Promise that never resolves if the UI doesn't surface the request.
2. **No stage timeout:** `runStage()` awaits the SDK session with no upper bound. A stalled session blocks the pipeline forever.
3. **Tight maxTurns:** `design_review` has 40 turns, barely enough for the orchestration flow (spawn team, wait, collect, produce handoff).

## Solution

### 1. Auto-Approve Orchestration Tools

Add orchestration tools to the auto-approve list in `sdk-manager.ts`'s `canUseTool` callback:

```
TeamCreate, TeamDelete, Task, TaskCreate, TaskUpdate, TaskList, TaskGet,
SendMessage, TaskOutput, TaskStop
```

These create/read JSON files under `~/.claude/teams/` and `~/.claude/tasks/` — no destructive codebase side effects.

### 2. Stage Timeout

Add `timeoutMs` to `StageConfig` and wrap the `sdkRunner()` call in `Promise.race()`:

| Stage | Timeout |
|-------|---------|
| brainstorm | 15 min |
| design_review | 20 min |
| plan | 10 min |
| implement | 30 min |
| code_review | 10 min |
| verify | 5 min |
| done | 5 min |

On timeout: abort the SDK session via `abortSession()`, emit `stage:error`, set task to `blocked`.

### 3. Increase design_review maxTurns

Bump from 40 to 60. The timeout is the real safety net; higher turns give orchestration flow room to complete.

### 4. Template Update

Rewrite `design-review-agent.md` to:
- Orchestrate team, collect joint summary, then produce `### HANDOFF` block
- Remove JSON verdict format (redundant with handoff protocol)
- Add single-agent fallback: if team creation fails, perform review solo and still produce the handoff
- Map verdicts into handoff: Approved → `completed`, Approved with Changes → `completed` (changes in Key Decisions), Needs Rework → `needs_intervention`

## Files Changed

| File | Change |
|------|--------|
| `src/main/sdk-manager.ts` | Add orchestration tools to auto-approve |
| `src/main/pipeline-engine.ts` | `Promise.race()` timeout in `runStage()` |
| `src/shared/constants.ts` | Add `timeoutMs` to STAGE_CONFIGS; bump design_review maxTurns to 60 |
| `src/shared/types.ts` | Add `timeoutMs` to StageConfig |
| `src/templates/design-review-agent.md` | Rewrite with team orchestration + fallback + handoff |

## What Does NOT Change

- `~/.claude/skills/design-review/SKILL.md` — correct for interactive Claude Code sessions
- `pipeline-rules.ts` — no transition logic changes
- `template-engine.ts` — handoff parsing already handles the format
- `_handoff.md` — protocol stays the same
