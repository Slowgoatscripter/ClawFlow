# Workshop Orchestrator: Task Grouping & Sub-Agent Dispatch

**Date:** 2026-02-27
**Status:** Approved

## Problem

ClawFlow has all the pieces — workshop for thinking, pipeline for doing, sub-agents available but unused — but they don't flow together well:

1. **Workshop and pipeline are disconnected.** You brainstorm in a workshop, then manually create tasks in the pipeline. The thinking and doing phases don't connect.
2. **Tasks are islands.** Even when tasks are part of the same feature, each runs its own brainstorm/plan/implement cycle independently. No shared context, no coordination.
3. **Sub-agents are underutilized.** The pipeline runs one task at a time through sequential stages. There's no parallel execution.

## Solution

Make the workshop session the **persistent orchestrator** for a task group. The workshop brainstorms, plans, breaks work into tasks with precise instructions, then dispatches parallel sub-agents through the pipeline — staying alive to monitor, coordinate, and intervene.

## Design

### The New Flow

```
WORKSHOP SESSION (persistent, acts as orchestrator)
  |
  |  Phase 1: THINK
  |  +-- Brainstorm the feature (existing capability)
  |  +-- Create design artifacts (existing capability)
  |  +-- Break into tasks with work orders (enhanced suggest_tasks)
  |  +-- Assign skills and file ownership per task
  |  +-- User approves -> "Launch now or queue?"
  |
  |  Phase 2: EXECUTE
  |  +-- Pipeline spawns sub-agents per task (parallel)
  |  +-- Sub-agents report progress back to workshop session
  |  +-- Workshop sees: stage transitions, completions, failures
  |  +-- Workshop can: answer agent questions, adjust plans, pause/resume
  |  +-- Any task failure -> entire group pauses, workshop notifies user
  |
  |  Phase 3: COMPLETE
  |  +-- All tasks pass code_review + verify
  |  +-- Workshop summarizes results
  |  +-- Session ends (or stays open for follow-up)
```

### Task Types

| Task Type | Stages | When |
|-----------|--------|------|
| **Grouped** (from workshop) | implement -> code_review -> verify -> done | Workshop already did the thinking |
| **Standalone L1** | plan -> implement -> done | One-shot simple job |
| **Standalone L2** | brainstorm -> plan -> implement -> verify -> done | One-shot medium job |
| **Standalone L3** | brainstorm -> design_review -> plan -> implement -> code_review -> verify -> done | One-shot complex job |

Standalone tasks are bigger "one-shot" jobs where you already know what you want. The workshop flow is for thinking first, then coordinating multiple pieces.

### Work Orders

When the workshop breaks a feature into tasks, each task gets a **work order** — structured implementation instructions that eliminate redundant codebase exploration.

```
WorkOrder
+-- objective: string            -- what this task accomplishes (1-2 sentences)
+-- files: FileTarget[]          -- files to create or modify
|   +-- path: string             -- e.g. src/main/pipeline-engine.ts
|   +-- action: 'create' | 'modify'
|   +-- description: string      -- what to do in this file
+-- patterns: string[]           -- conventions to follow
+-- integration: string[]        -- how this connects to sibling tasks
+-- constraints: string[]        -- things to avoid
+-- tests: string[]              -- expected test coverage
```

File ownership is critical: the workshop assigns files to specific tasks so parallel sub-agents don't conflict. If two tasks need the same file, the workshop either combines them or declares a dependency.

### Skills & System Prompts

#### Workshop Agent (Orchestrator)

The workshop agent needs a ClawFlow-aware system prompt that teaches it the environment — what tools it has, how to create tasks, launch groups, read sub-agent status, use knowledge, create artifacts.

| Skill | Purpose |
|-------|---------|
| brainstorming | Explore ideas, understand requirements |
| design-review | Challenge assumptions (panel mode) |
| writing-plans | Break features into tasks with work orders |
| orchestration (new) | Monitor sub-agents, handle failures, coordinate |

#### Sub-Agents (Implementers)

Sub-agents still use skills — they're writing real code. The workshop assigns the skill during planning.

| Skill | Purpose |
|-------|---------|
| test-driven-development | Write tests first, then implementation |
| frontend-design | When the task is UI work |
| security-review | When touching auth/input/APIs |
| verification-before-completion | Before reporting done |

#### Sub-Agent Prompt Structure

```
Sub-Agent Prompt
+-- System prompt (role, constraints, how to signal problems)
+-- Work order (objective, files, patterns, integration, tests)
+-- Assigned skill content (e.g. TDD methodology)
+-- Relevant project knowledge (conventions, past lessons from FDRL)
+-- Group awareness (what sibling tasks are doing, shared design doc)
+-- Escalation rules (when to message workshop vs. keep going)
```

### Workshop <-> Sub-Agent Communication

#### Workshop Tools (new)

| Tool | Purpose |
|------|---------|
| `launch_group(tasks)` | Kick off parallel sub-agents |
| `get_group_status()` | Current state of all tasks in the group |
| `peek_agent(taskId)` | Read a sub-agent's recent output |
| `message_agent(taskId, content)` | Send instruction to a sub-agent |
| `pause_group()` | Halt all sub-agents |
| `resume_group()` | Restart paused agents |
| `update_work_order(taskId, changes)` | Modify a task's instructions mid-flight |

#### Sub-Agent Tools (new)

| Tool | Purpose |
|------|---------|
| `signal_workshop(type, content)` | Escalate to workshop (types: question, conflict, blocker, update) |

#### Events Workshop Receives

| Event | Content |
|-------|---------|
| `agent_stage_complete` | Structured summary: what was done, files modified, test results |
| `agent_question` | Sub-agent needs help, work order unclear |
| `agent_failure` | Something went wrong, triggers group pause |
| `group_complete` | All tasks finished successfully |

#### User Experience

The user interacts with the **workshop session** as the single pane of glass. The workshop provides regular light progress updates (stage transitions, brief summaries) in chat. The main dashboard shows detailed pipeline status. The workshop escalates anything that needs user attention (failures, questions, decisions).

### Data Model

#### New Type: TaskGroup

```typescript
interface TaskGroup {
  id: number
  title: string                  // feature name
  sessionId: number              // workshop session that created this
  status: 'planning' | 'queued' | 'running' | 'paused' | 'completed' | 'failed'
  designArtifactId: number | null // workshop's design doc artifact
  sharedContext: string          // summary/plan all sub-agents receive
  createdAt: string
  updatedAt: string
}
```

#### New Type: WorkOrder

```typescript
interface WorkOrder {
  objective: string
  files: Array<{
    path: string
    action: 'create' | 'modify'
    description: string
  }>
  patterns: string[]
  integration: string[]
  constraints: string[]
  tests: string[]
}
```

#### Task Extensions

```typescript
// Added to existing Task interface
groupId: number | null           // which group this belongs to (null = standalone)
workOrder: WorkOrder | null      // structured implementation instructions
assignedSkill: string | null     // skill the workshop assigned
```

#### Database Changes

**New table: `task_groups`**

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Group ID |
| title | TEXT | Feature name |
| session_id | INTEGER FK | Workshop session |
| status | TEXT | planning/queued/running/paused/completed/failed |
| design_artifact_id | INTEGER FK nullable | Workshop artifact |
| shared_context | TEXT | JSON shared plan |
| created_at | TEXT | Timestamp |
| updated_at | TEXT | Timestamp |

**Modified table: `tasks`** -- add columns:

| Column | Type | Description |
|--------|------|-------------|
| group_id | INTEGER FK nullable | Links to task_groups |
| work_order | TEXT nullable | JSON serialized WorkOrder |
| assigned_skill | TEXT nullable | Skill name for implementation |

#### Group Status Lifecycle

```
planning -> queued -> running -> completed
               |         |
               |         +-> paused (any task fails/rejected)
               |               |
               |               +-> running (user resumes)
               |
               +-> (user never launches, stays in backlog)
```

### Pipeline Engine Changes

#### New Methods

| Method | Purpose |
|--------|---------|
| `launchGroup(groupId)` | Create worktrees, spawn parallel sub-agents, set group to running |
| `pauseGroup(groupId)` | Pause all running tasks in the group |
| `resumeGroup(groupId)` | Resume paused tasks |
| `getGroupStatus(groupId)` | Return status of all tasks + summary |

#### launchGroup Flow

```
launchGroup(groupId)
  |
  +-- Load group + all tasks
  +-- Validate: no file ownership conflicts across tasks
  +-- For each task (parallel):
  |   +-- Create git worktree (existing logic)
  |   +-- Build prompt from work order + skill + knowledge (new template path)
  |   +-- Spawn SDK session (existing sdk-manager)
  |   +-- Wire up event forwarding to workshop session
  |   +-- Start at implement stage
  |
  +-- Monitor: listen for stage completions, failures, questions
       +-- On any failure -> pauseGroup(), notify workshop
```

#### New Template: grouped-implement-agent.md

For grouped tasks, a new prompt template built around work orders instead of handoffs:

```
Role: "You are implementing a specific task within a larger feature"
Work order: {{ workOrder }}
Assigned skill: {{ skill content }}
Group context: {{ sharedContext from group }}
Sibling awareness: {{ what other tasks are doing, file boundaries }}
Project knowledge: {{ relevant conventions/lessons }}
Escalation: "Use signal_workshop() if work order doesn't match reality"
```

Post-implementation stages (code_review, verify, done) work the same as today.

### What Changes vs. What Stays

#### Changes

| Component | Change |
|-----------|--------|
| `pipeline-engine.ts` | Add launchGroup, pauseGroup, resumeGroup, getGroupStatus |
| `template-engine.ts` | Add grouped template path, work order prompt construction |
| `workshop-engine.ts` | Add orchestration tools, event handling, sub-agent communication, ClawFlow environment awareness |
| `db.ts` | Add task_groups table, new columns on tasks |
| `types.ts` | Add TaskGroup, WorkOrder types, extend Task |
| `constants.ts` | Add grouped task stage sequence |
| `index.ts` | Add IPC handlers for group operations |
| New templates | grouped-implement-agent.md, updated workshop system prompt |

#### Stays the Same

- Standalone task flow (all tiers)
- Stage execution core (runStage)
- SDK session management (retry, approval, streaming)
- Git worktrees (one per task)
- Handoff parsing
- Code review + verify stages
- FDRL knowledge capture
- Dashboard UI (extended, not replaced)

## Why This Isn't Just Rebuilding Claude Code

Claude Code provides raw tools (team lead, sub-agents, messaging). ClawFlow adds:

- **Institutional memory** -- FDRL, domain knowledge, conventions learned from past rejections
- **Structured quality gates** -- code review and verify stages are enforced, not optional
- **Work orders with codebase context** -- sub-agents get precise instructions instead of starting cold
- **Persistent artifacts** -- design docs, diagrams, specs live in the database and feed future tasks
- **Failure learning** -- rejections become knowledge that improves future agent performance
