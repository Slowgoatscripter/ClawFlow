# Usage-Aware Pause/Resume

**Date:** 2026-02-26
**Status:** Draft

## Problem

When API usage runs out mid-task, agents fail silently — tasks move to `blocked` with no explanation. There's no way to pause a running task, no visibility into context window consumption, and no proactive warning before hitting limits.

## Solution

Three features working together:

1. **Usage Monitor** — polls Anthropic OAuth API for utilization, triggers auto-pause at 95%
2. **Per-Task Pause/Resume** — abort running agents, resume via SDK session continuation
3. **Context Bar on Task Cards** — shows context window consumption per running agent

## Design

### 1. New Task Status: `paused`

Add `paused` to `TaskStatus` union. Tasks can be paused from any active status (`brainstorming`, `planning`, `implementing`, `code_review`, `verifying`). Resume returns them to their pre-pause status and re-runs the current stage with session resume.

```
TaskStatus: backlog | brainstorming | design_review | planning | implementing
           | code_review | verifying | done | blocked | paused
```

**New fields on Task:**
- `pausedFromStatus: TaskStatus | null` — the status to restore on resume
- `pauseReason: 'manual' | 'usage_limit' | null` — why it was paused

### 2. Usage Monitor Service

New module: `src/main/usage-monitor.ts`

**Data source:** Same as MiniClaw — `GET https://api.anthropic.com/api/oauth/usage` with OAuth token from `keytar` (service: `claude-code`, account: `oauth_token`).

**Polling:** Every 60 seconds while any task is running. Stops polling when all tasks are idle.

**Response shape** (from Anthropic API):
```ts
interface UsageBucket {
  utilization: number    // 0-100 float
  resets_at: string      // ISO 8601
}

interface UsageSnapshot {
  connected: boolean
  error: string | null
  fiveHour: { utilization: number; countdown: string } | null
  sevenDay: { utilization: number; countdown: string } | null
  sevenDayOpus: { utilization: number; countdown: string } | null
  sevenDaySonnet: { utilization: number; countdown: string } | null
}
```

**Auto-pause trigger:** When `fiveHour.utilization >= 95` (configurable via settings key `usage.autoPauseThreshold`, default `95`):
1. Emit `usage:limit-approaching` event
2. Pause all running tasks (same as manual pause — abort + save session)
3. Send `pipeline:status` with `type: 'usage-paused'` to renderer for toast/banner

**Token source for OAuth:** Read from system keychain via `keytar` — same credential store Claude Code CLI uses. Fail gracefully if not available (disable usage monitoring, log warning).

### 3. Per-Task Pause/Resume

**Pause flow:**
1. User clicks Pause on a task card (or auto-pause triggers)
2. IPC `pipeline:pause` → `PipelineEngine.pauseTask(taskId)`
3. `pauseTask()`:
   - Saves `task.status` to `pausedFromStatus`
   - Calls `abortSession(sessionKey)` to kill the running agent
   - Sets `status: 'paused'`, `pauseReason: 'manual' | 'usage_limit'`
   - Emits `stage:paused` event
4. Task card moves to a new "Paused" column (or stays in place with a paused overlay — TBD)

**Resume flow:**
1. User clicks Resume (or usage resets and auto-resume triggers)
2. IPC `pipeline:resume` → `PipelineEngine.resumeTask(taskId)`
3. `resumeTask()`:
   - Restores `status` from `pausedFromStatus`
   - Calls `runStage(taskId, currentStage)` with `resumeSessionId` from `this.sessionIds`
   - The SDK resumes the conversation with a "please continue" system prompt
   - Clears `pausedFromStatus` and `pauseReason`

**Auto-resume:** When usage monitor detects utilization has dropped below threshold (e.g. after reset), optionally resume paused tasks. Controlled by setting `usage.autoResume` (default `false` — user must manually resume to avoid surprise cost).

### 4. Context Bar on Task Cards

Each running task card shows a thin progress bar representing the agent's context window usage.

**Data source:** The SDK runner already tracks token usage per turn. We need to accumulate `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` from each streamed response and emit it.

**New stream event:**
```ts
// Emitted alongside existing 'stream' events
this.emit('context-update', {
  taskId,
  stage,
  contextTokens: number,   // accumulated input context
  contextMax: 200_000,     // model context limit
})
```

**UI rendering:** A thin bar below the task title in KanbanColumn cards:
- Green: 0-50% context used
- Yellow: 50-80% context used
- Red: 80%+ context used
- Tooltip: "142k / 200k tokens"

### 5. New Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `usage.autoPauseThreshold` | `number` | `95` | Five-hour utilization % to trigger auto-pause |
| `usage.autoResume` | `boolean` | `false` | Auto-resume paused tasks when usage resets |
| `usage.monitorEnabled` | `boolean` | `true` | Enable/disable usage monitoring |

### 6. New IPC Channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `pipeline:pause` | renderer → main | `{ taskId: number }` |
| `pipeline:resume` | renderer → main | `{ taskId: number }` |
| `pipeline:pause-all` | renderer → main | `{}` |
| `usage:snapshot` | main → renderer | `UsageSnapshot` |
| `usage:get-snapshot` | renderer → main | `{}` → `UsageSnapshot` |
| `pipeline:context-update` | main → renderer | `{ taskId, contextTokens, contextMax }` |

### 7. UI Changes

**KanbanBoard:**
- Add `paused` to `COLUMN_ORDER` (between `blocked` and `done`, or as a distinct section)
- Paused column styled with a muted/dimmed theme color

**Task Cards (KanbanColumn):**
- Context bar below title for running tasks
- Pause button (visible when task is in an active status)
- Resume button (visible when task is paused)
- Pause reason badge: "Manual" or "Usage Limit"

**TopBar:**
- Small usage indicator showing five-hour utilization + countdown to reset
- "Pause All" button when any tasks are running
- Toast/banner when auto-pause triggers: "Usage at 95% — paused N running tasks. Resets in Xh Ym."

**TaskDetail:**
- Pause/Resume button in the action bar
- Context usage displayed alongside other agent metadata

## Files to Create/Modify

**New files:**
- `src/main/usage-monitor.ts` — Usage polling service
- `src/shared/usage-types.ts` — Shared types for usage data

**Modified files:**
- `src/shared/types.ts` — Add `paused` to TaskStatus, add pausedFromStatus/pauseReason to Task
- `src/shared/constants.ts` — Add paused to STAGE_TO_STATUS if needed
- `src/shared/settings.ts` — Add usage settings keys
- `src/main/pipeline-engine.ts` — Add `pauseTask()`, `resumeTask()`, context tracking
- `src/main/sdk-manager.ts` — Emit context token counts during streaming
- `src/main/ipc-handlers.ts` — Wire new IPC channels
- `src/main/index.ts` — Initialize usage monitor, wire events
- `src/preload/index.ts` — Expose new IPC channels
- `src/renderer/src/global.d.ts` — Type the new API surface
- `src/renderer/src/stores/pipelineStore.ts` — Handle pause/resume state, context updates, usage snapshots
- `src/renderer/src/components/KanbanBoard/KanbanBoard.tsx` — Add paused column
- `src/renderer/src/components/KanbanBoard/KanbanColumn.tsx` — Context bar, pause/resume buttons
- `src/renderer/src/components/TaskDetail/TaskDetail.tsx` — Pause/resume in detail view
- `src/renderer/src/components/Dashboard/TopBar.tsx` — Usage indicator, pause all button
- `src/renderer/src/index.css` — Styles for context bar, paused state, usage indicator

## Out of Scope

- Pacing-based prediction (future enhancement over threshold)
- Per-model context limits (hardcode 200k for now, all current models use it)
- Cost estimation on task cards (MiniClaw handles this separately)
- JSONL session file parsing (we get tokens from the SDK directly)
