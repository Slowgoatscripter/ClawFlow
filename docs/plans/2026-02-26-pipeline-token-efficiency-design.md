# Pipeline Token Efficiency — Design Document

**Date:** 2026-02-26
**Status:** Approved
**Scope:** All tiers (L1, L2, L3)
**Priority:** Quality first; efficiency gains must be noteworthy

---

## Problem

The current pipeline spawns a fresh agent for each stage. Each agent:
- Re-reads the codebase from scratch (~10K–30K tokens of tool calls)
- Receives all prior stage outputs re-injected into its prompt (cumulative growth)
- Gets metadata noise (`cost`, `sessionId`) and redundant content in prompts

For an L3 task, cumulative prompt tokens across all 7 stages reach **45K–80K+**, with ~40–50% being repeated content.

---

## Solution: Continuous Agent with Stage-Boundary Handoffs

### Core Architecture

A single agent runs the full pipeline for a task. Instead of spawning a new agent per stage, the pipeline engine injects **stage transition messages** into the same SDK session.

**Flow:**
1. Pipeline engine constructs initial prompt with stage 1 template + skill
2. Agent completes stage, produces handoff block
3. Engine parses handoff, stores in DB
4. If stage pauses: session suspends, user reviews and approves/rejects
5. On approval: engine sends a continuation prompt into the same session with stage N+1 template + skill
6. Agent continues with full prior context already in conversation history
7. Repeat until pipeline completes or context handoff triggers

**What this eliminates:**
- No re-injection of prior stage outputs (already in context)
- No codebase re-exploration (agent already read the files)
- Per-stage prompt drops to: template (~200 tokens) + skill (~1K–2.5K tokens) + user feedback

### Pre-Stage Context Budget Check

Before entering each stage, the engine checks whether sufficient context remains.

**Estimated stage budgets:**

| Stage | Est. Budget |
|-------|------------|
| brainstorm | ~15K |
| design_review | ~20K |
| plan | ~10K |
| implement | ~60K |
| code_review | ~15K |
| verify | ~10K |
| done | ~5K |

**Decision logic:**
```
remainingContext = modelLimit - currentUsage
if (remainingContext < estimatedStageBudget * 1.2)  // 20% safety margin
  → trigger handoff before entering stage
else
  → continue in same session
```

**Expected behavior:** Most L1 and L2 tasks complete in a single session. L3 tasks typically handoff once, most likely before `implement`.

### Handoff Flow

1. System detects insufficient context for next stage
2. User notified: "Context at ~X% capacity. Next stage needs more room. Recommend handoff."
3. User approves
4. Current agent produces a **rich handoff document**
5. Fresh agent spawns with: rich handoff + next stage template + skill
6. Pipeline continues from that stage forward

### Rich Handoff Document

Three layers:

**Layer 1 — Pipeline State:**
- All completed stage outputs (`.output` only, no metadata noise)
- Handoff chain summaries
- Task metadata (title, description, tier, priority)
- User feedback/rejections

**Layer 2 — Codebase Knowledge Map:**
- File tree of explored portions
- Key files with brief summaries (path, purpose, size, key functions)
- Architecture patterns identified
- Dependencies/imports graph for modified files

**Layer 3 — Working State:**
- Next stage to execute
- Open questions or pending decisions
- Files modified in worktree so far
- Gotchas or warnings discovered

**Estimated size:** ~2K–5K tokens (vs ~10K–30K for codebase re-exploration).

### Stage Transition Mechanics

**Current (one agent per stage):**
```
startTask → runStage(brainstorm) → spawn agent → kill → pause
         → approve → runStage(plan) → spawn agent → kill → pause
         → ...
```

**New (continuous agent):**
```
startTask → startSession(brainstorm prompt + skill)
         → complete → parseHandoff → pause
         → approve → injectContinuation(plan prompt + skill)
         → complete → parseHandoff → contextCheck()
         → sufficient → injectContinuation(implement prompt + skill)
         → complete → contextCheck()
         → insufficient → richHandoff → pause for user
         → approve → startSession(richHandoff + stage prompt + skill)
         → continues...
```

**Implementation details:**
- `runStage()` no longer spawns a new session unless first stage or post-handoff
- New `injectContinuation(stageConfig)` sends user-role message into existing session
- Session ID persisted on task object for resume after pauses
- `contextCheck()` queries token usage before each transition
- Existing pause/approve/reject flow unchanged from user perspective

---

## Prompt Efficiency Fixes

Applied regardless of continuous agent model. All 8 items in scope.

### High Impact

**1. Strip metadata from injected outputs**
Extract only `.output` from stored JSON objects. Change `JSON.stringify(task.plan, null, 2)` to `task.plan?.output ?? 'N/A'`. Applies to: plan, implementationNotes, reviewComments, designReview, testResults.

**2. Remove brainstorm re-injection in L3 plan stage**
The plan agent already receives design review handoff in `{{previous_handoff}}`. Replace `{{brainstorm_output}}` in plan-agent.md with a reference: "Brainstorm output reviewed in design_review stage. See previous handoff for decisions." Tier-aware: L2 keeps brainstorm injection (no design review stage).

**3. Replace full outputs with handoff summaries in code_review**
Replace `{{plan}}` and `{{implementation_notes}}` with relevant handoff summaries. Agent uses Read/Grep to inspect actual code.

**4. Replace full implementation_notes with handoff summary in verify**
Verify agent should run tests and read code, not re-parse text dumps.

### Medium Impact

**5. Skip `_handoff.md` for templates with inline handoff instructions**
Don't append to design-review-agent.md and completion-agent.md. Save ~324 tokens each.

**6. Switch to compact JSON**
Use `JSON.stringify(x)` instead of `JSON.stringify(x, null, 2)` for remaining JSON injections. ~15% whitespace reduction.

**7. Remove double timestamp signatures**
Keep top signature only, remove bottom "sign your work" directive.

### Low Impact

**8. Remove `## Skill Requirement` boilerplate**
The appended skill content is self-evident. Remove the meta-instruction section from templates.

### Estimated Savings

- Prompt fixes alone: **25–40% reduction** in cumulative prompt tokens
- Continuous agent model: eliminates re-injection entirely for stages within same session
- Combined: **50–70% reduction** in total pipeline token cost for typical L3 tasks

---

## UX Impact

**What stays the same:**
- Stage-by-stage review flow
- Approval/rejection buttons
- Handoff blocks visible in UI
- All existing pipeline controls

**What's new:**
- Context handoff notification (appears as an approval prompt)
- Slightly different stage output format (continuation messages vs fresh prompts — invisible to user)

---

## Risks

- **Context estimation accuracy:** Stage budgets are estimates; actual usage varies. The 20% safety margin provides buffer. Can be tuned over time with real usage data.
- **Session resume after pause:** SDK supports `resumeSessionId`. Need to verify it works reliably for multi-hour gaps between user approvals.
- **Rich handoff quality:** Depends on the agent producing a good knowledge map. Template needs to be well-structured with clear instructions.
