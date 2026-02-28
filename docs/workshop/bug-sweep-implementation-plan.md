# Bug Sweep — Workshop & Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all identified bugs in the Workshop and Pipeline systems, grouped by file ownership to enable parallel execution.

**Architecture:** Fixes are organized into 3 waves. Wave 1 tasks are fully independent and can run in parallel. Wave 2 tasks depend on Wave 1 completing. Wave 3 is final cleanup.

**Tech Stack:** TypeScript, Electron IPC, Zustand, Claude SDK

---

## Wave 1 — Parallel (all independent)

---

### Task A: Fix `pipeline-engine.ts` — C1, H1, M2

**Bugs fixed:** C1 (JSON.parse crash), H1 (pause guard missing), M2 (no context budget check in grouped tasks)

**Files:**
- Modify: `src/pipeline/pipeline-engine.ts` — `runGroupedStage` method

---

#### A.1 — Fix C1: Parse colon-delimited context string correctly

The `__context:N:M` string is NOT JSON. It is a colon-delimited marker. `JSON.parse()` will always throw.

**Step 1: Locate the broken parse**

Search `runGroupedStage` for:
```typescript
const context = JSON.parse(contextString);
```

**Step 2: Write a failing unit test**

```typescript
// tests/pipeline/pipeline-engine.test.ts
describe('runGroupedStage context parsing', () => {
  it('parses __context:N:M format without throwing', () => {
    const raw = '__context:3:12';
    const result = parseGroupedContext(raw);
    expect(result.groupId).toBe(3);
    expect(result.taskIndex).toBe(12);
  });
});
```

**Step 3: Run test to confirm it fails**
```bash
npx jest pipeline-engine --testNamePattern="context parsing"
```
Expected: FAIL — `SyntaxError: Unexpected token`

**Step 4: Implement the fix**

Extract a helper:
```typescript
function parseGroupedContext(raw: string): { groupId: number; taskIndex: number } {
  // Format: __context:groupId:taskIndex
  const parts = raw.split(':');
  if (parts.length !== 3 || parts[0] !== '__context') {
    throw new Error(`Invalid grouped context string: ${raw}`);
  }
  return {
    groupId: parseInt(parts[1], 10),
    taskIndex: parseInt(parts[2], 10),
  };
}
```

Replace the `JSON.parse` call with `parseGroupedContext(contextString)`.

**Step 5: Run test to confirm pass**
```bash
npx jest pipeline-engine --testNamePattern="context parsing"
```
Expected: PASS

**Step 6: Commit**
```bash
git add src/pipeline/pipeline-engine.ts tests/pipeline/pipeline-engine.test.ts
git commit -m "fix(pipeline): parse __context:N:M string without JSON.parse (C1)"
```

---

#### A.2 — Fix H1: Add `status !== 'paused'` guard in catch block

When a grouped task is paused, the outer catch block sets it to `blocked` instead of respecting the pause.

**Step 1: Write failing test**
```typescript
it('does not set status to blocked when task is paused mid-run', async () => {
  // Arrange: task that throws after pause is triggered
  const task = mockGroupedTask({ status: 'paused' });
  // Act: simulate error thrown during paused state
  await engine.runGroupedStage(task, mockContext);
  // Assert: status remains 'paused', not 'blocked'
  expect(task.status).toBe('paused');
});
```

**Step 2: Run to confirm fail**
```bash
npx jest pipeline-engine --testNamePattern="does not set status to blocked"
```

**Step 3: Add the guard**

In `runGroupedStage`'s catch block:
```typescript
} catch (err) {
  // H1 fix: don't overwrite paused status
  const currentStatus = await db.getTaskStatus(task.id);
  if (currentStatus !== 'paused') {
    await db.setTaskStatus(task.id, 'blocked');
    await db.setTaskError(task.id, err.message);
  }
}
```

**Step 4: Run to confirm pass**
```bash
npx jest pipeline-engine --testNamePattern="does not set status to blocked"
```

**Step 5: Commit**
```bash
git add src/pipeline/pipeline-engine.ts
git commit -m "fix(pipeline): guard against overwriting 'paused' status in grouped catch block (H1)"
```

---

#### A.3 — Fix M2: Call `checkContextBudget` in `runGroupedStage`

`runGroupedStage` skips the context budget check that `runStage` performs, so grouped tasks can exhaust the context window.

**Step 1: Locate `checkContextBudget` call in `runStage`** (the working path)

**Step 2: Add the same call near the start of `runGroupedStage`**
```typescript
async runGroupedStage(task, context) {
  await this.checkContextBudget(task); // M2 fix
  // ... rest of method
}
```

**Step 3: Run full pipeline-engine tests**
```bash
npx jest pipeline-engine
```
Expected: all pass

**Step 4: Commit**
```bash
git add src/pipeline/pipeline-engine.ts
git commit -m "fix(pipeline): call checkContextBudget in runGroupedStage (M2)"
```

---

### Task B: Fix `pipeline-engine.ts` — M4 (done-counter infinite rejection)

> **Depends on Task A completing first** (same file).

**Bug:** `rejectStage` never increments the counter when stage is `done`, enabling infinite rejection loops.

**Files:**
- Modify: `src/pipeline/pipeline-engine.ts` — `rejectStage` method

**Step 1: Write failing test**
```typescript
it('increments rejection counter when rejecting the done stage', async () => {
  const task = mockTask({ stage: 'done', rejectionCount: 0 });
  await engine.rejectStage(task);
  expect(task.rejectionCount).toBe(1);
});
```

**Step 2: Run to confirm fail**
```bash
npx jest pipeline-engine --testNamePattern="increments rejection counter.*done"
```

**Step 3: Add the missing case**

In `rejectStage`'s switch/if block, add:
```typescript
case 'done':
  task.rejectionCount = (task.rejectionCount ?? 0) + 1;
  break;
```

**Step 4: Run to confirm pass + run full suite**
```bash
npx jest pipeline-engine
```

**Step 5: Commit**
```bash
git add src/pipeline/pipeline-engine.ts
git commit -m "fix(pipeline): increment rejection counter on 'done' stage rejection (M4)"
```

---

### Task C: Fix `workshop-engine.ts` — C2, C3, H2

**Bugs fixed:** C2 (single-integer activeGroupId), C3 (stuck queued on null pipelineEngine), H2 (wrong session UUID for groups)

**Files:**
- Modify: `src/workshop/workshop-engine.ts`

---

#### C.1 — Fix C2: Replace `activeGroupId: number` with per-session map

**Step 1: Write failing test**
```typescript
it('tracks activeGroupId independently per session', () => {
  const engine = new WorkshopEngine();
  engine.setActiveGroup('session-A', 1);
  engine.setActiveGroup('session-B', 2);
  expect(engine.getActiveGroup('session-A')).toBe(1);
  expect(engine.getActiveGroup('session-B')).toBe(2); // currently returns 2 for both (BUG)
});
```

**Step 2: Run to confirm fail**
```bash
npx jest workshop-engine --testNamePattern="tracks activeGroupId independently"
```

**Step 3: Replace the field**
```typescript
// Before:
private activeGroupId: number | null = null;

// After:
private activeGroupBySession: Map<string, number> = new Map();

setActiveGroup(sessionId: string, groupId: number) {
  this.activeGroupBySession.set(sessionId, groupId);
}

getActiveGroup(sessionId: string): number | undefined {
  return this.activeGroupBySession.get(sessionId);
}

clearActiveGroup(sessionId: string) {
  this.activeGroupBySession.delete(sessionId);
}
```

Update all callsites that reference `this.activeGroupId` to use `this.getActiveGroup(sessionId)`.

**Step 4: Run to confirm pass**
```bash
npx jest workshop-engine
```

**Step 5: Commit**
```bash
git add src/workshop/workshop-engine.ts
git commit -m "fix(workshop): replace singleton activeGroupId with per-session map (C2)"
```

---

#### C.2 — Fix C3: Check `pipelineEngine` nullability BEFORE setting status to `queued`

**Step 1: Write failing test**
```typescript
it('does not set group to queued when pipelineEngine is null', async () => {
  const engine = new WorkshopEngine({ pipelineEngine: null });
  await engine.handleLaunchGroup({ groupId: 1 });
  const group = await db.getGroup(1);
  expect(group.status).not.toBe('queued'); // should be 'error'
});
```

**Step 2: Run to confirm fail**

**Step 3: Fix the ordering in `handleLaunchGroup`**
```typescript
async handleLaunchGroup({ groupId }) {
  // C3 fix: guard BEFORE mutating DB state
  if (!this.pipelineEngine) {
    await db.setGroupStatus(groupId, 'error');
    await db.setGroupError(groupId, 'Pipeline engine not initialized');
    return;
  }
  await db.setGroupStatus(groupId, 'queued');
  // ... rest of launch logic
}
```

**Step 4: Run to confirm pass**
```bash
npx jest workshop-engine
```

**Step 5: Commit**
```bash
git add src/workshop/workshop-engine.ts
git commit -m "fix(workshop): check pipelineEngine before marking group as queued (C3)"
```

---

#### C.3 — Fix H2: Return proper session UUID from `getSessionForGroup`

**Step 1: Write failing test**
```typescript
it('returns a valid session UUID, not a numeric row ID coerced to string', async () => {
  const result = await engine.getSessionForGroup(42);
  expect(result).toMatch(/^[0-9a-f-]{36}$/);
});
```

**Step 2: Run to confirm fail**

**Step 3: Fix the query**

The bug is likely:
```typescript
// Before (wrong — returns DB row id):
return String(row.id);

// After (correct — return the session UUID column):
return row.sessionUuid;
```

Verify the DB schema has a `sessionUuid` column on the groups table. If not, add it in a migration.

**Step 4: Run to confirm pass**
```bash
npx jest workshop-engine
```

**Step 5: Commit**
```bash
git add src/workshop/workshop-engine.ts
git commit -m "fix(workshop): getSessionForGroup returns sessionUuid not row id (H2)"
```

---

### Task D: Fix `workshop-engine.ts` misc — M1, L2, L3

> **Depends on Task C completing first** (same file).

---

#### D.1 — Fix M1: Remove double-history on resumed sessions

`buildPrompt` inlines conversation history AND passes it to the SDK session, doubling context on resume.

**Step 1: Write failing test**
```typescript
it('does not include history twice when resuming a session', async () => {
  const prompt = await engine.buildPrompt(resumedSession);
  const historyOccurrences = countOccurrences(prompt, MARKER_MESSAGE);
  expect(historyOccurrences).toBe(1); // currently 2
});
```

**Step 2: Fix `buildPrompt`** — remove the inline history injection when an SDK session already carries it:
```typescript
// Only inline history for new sessions (no resumedSessionId)
if (!session.resumedSessionId) {
  prompt.messages.push(...history);
}
```

**Step 3: Run + commit**
```bash
git commit -m "fix(workshop): prevent double-history injection on session resume (M1)"
```

---

#### D.2 — Fix L2: Remove bracket-notation access of private `dbPath`

```typescript
// Before:
const path = (this as any)['dbPath'];

// After: add a protected getter
protected get dbPath(): string {
  return this._dbPath;
}
```

Update `workshop:recover-session` handler to use the getter.

**Commit:**
```bash
git commit -m "fix(workshop): expose dbPath via getter, remove bracket-notation hack (L2)"
```

---

#### D.3 — Fix L3: Clear stall timer on component unmount

`setupListeners` sets a stall timer that persists across remounts.

```typescript
// In setupListeners, store the timer handle:
const stallTimer = setTimeout(handleStall, STALL_TIMEOUT);

// Return cleanup function (or store on instance):
return () => clearTimeout(stallTimer);
```

Ensure the cleanup is called on unmount.

**Commit:**
```bash
git commit -m "fix(workshop): clear stall timer on unmount to prevent stale handlers (L3)"
```

---

### Task E: Fix `pipelineStore.ts` — H4 (dismiss no-op)

**Bug:** `dismissContextHandoff` doesn't call `rejectContextHandoff` IPC, leaving tasks stuck.

**Files:**
- Modify: `src/stores/pipelineStore.ts`

**Step 1: Write failing test**
```typescript
it('calls rejectContextHandoff IPC when dismiss is triggered', async () => {
  const ipc = mockIpc();
  store.dismissContextHandoff({ taskId: 5 });
  expect(ipc.invoke).toHaveBeenCalledWith('pipeline:rejectContextHandoff', { taskId: 5 });
});
```

**Step 2: Run to confirm fail**

**Step 3: Fix the store action**
```typescript
dismissContextHandoff: async ({ taskId }) => {
  // H4 fix: actually reject the handoff via IPC
  await window.electron.ipcRenderer.invoke('pipeline:rejectContextHandoff', { taskId });
  set(state => ({
    contextHandoff: state.contextHandoff.filter(h => h.taskId !== taskId)
  }));
},
```

**Step 4: Run to confirm pass + commit**
```bash
git commit -m "fix(store): dismissContextHandoff now calls rejectContextHandoff IPC (H4)"
```

---

### Task F: Fix `pipeline-rules.ts` — M3 (circuit breaker bypass)

**Bug:** `canTransition` only guards `plan` and `implement` targets. `brainstorm` and `code_review` bypass the circuit breaker.

**Files:**
- Modify: `src/pipeline/pipeline-rules.ts` — `canTransition`

**Step 1: Write failing tests**
```typescript
it('blocks transition to brainstorm when circuit breaker is open', () => {
  const result = canTransition(openCircuit, { to: 'brainstorm' });
  expect(result.allowed).toBe(false);
});

it('blocks transition to code_review when circuit breaker is open', () => {
  const result = canTransition(openCircuit, { to: 'code_review' });
  expect(result.allowed).toBe(false);
});
```

**Step 2: Run to confirm fail**

**Step 3: Update the circuit breaker check**

```typescript
// Before: only guards plan and implement
const CIRCUIT_BREAKER_STAGES = ['plan', 'implement'];

// After: guard all substantive stages
const CIRCUIT_BREAKER_STAGES = ['plan', 'implement', 'brainstorm', 'code_review'];
```

**Step 4: Run full rules tests + commit**
```bash
npx jest pipeline-rules
git commit -m "fix(rules): extend circuit breaker to cover brainstorm and code_review stages (M3)"
```

---

### Task G: Fix usage-monitor + `index.ts` — H5 (no auto-resume after limit)

**Bug:** No `limit-cleared` event or auto-resume path. Usage-paused tasks stay paused forever.

**Files:**
- Modify: `src/pipeline/usage-monitor.ts` — emit `limit-cleared`
- Modify: `src/main/index.ts` — handle `limit-cleared` → resume paused tasks

**Step 1: Write failing test for monitor**
```typescript
it('emits limit-cleared event when usage drops below threshold', async () => {
  const monitor = new UsageMonitor();
  const spy = jest.fn();
  monitor.on('limit-cleared', spy);
  monitor.simulateUsageDrop(); // usage goes from over-limit to under
  expect(spy).toHaveBeenCalled();
});
```

**Step 2: Implement in `usage-monitor.ts`**
```typescript
private previouslyLimited = false;

private checkUsage(current: UsageStats) {
  const isLimited = current.tokensUsed >= current.limit;
  if (this.previouslyLimited && !isLimited) {
    this.emit('limit-cleared');
  }
  this.previouslyLimited = isLimited;
  // ... rest of check
}
```

**Step 3: Write failing test for index.ts handler**
```typescript
it('resumes all usage-paused tasks when limit-cleared fires', async () => {
  const pausedTask = await db.createTask({ status: 'usage-paused' });
  usageMonitor.emit('limit-cleared');
  await flushPromises();
  const updated = await db.getTask(pausedTask.id);
  expect(updated.status).toBe('queued');
});
```

**Step 4: Implement the handler in `index.ts`**
```typescript
usageMonitor.on('limit-cleared', async () => {
  const pausedTasks = await db.getTasksByStatus('usage-paused');
  for (const task of pausedTasks) {
    await pipelineEngine.requeueTask(task.id);
  }
});
```

**Step 5: Run all tests + commit**
```bash
npx jest usage-monitor index
git commit -m "fix(pipeline): emit limit-cleared and auto-resume usage-paused tasks (H5)"
```

---

## Wave 2 — After Wave 1 completes

### Task H: Fix `workshop-engine.ts` — H3 (token race condition)

> **Depends on Tasks C and D** (same file).

**Bug:** `trackTokens` has a parallel read-modify-write race in `triggerDiscuss`.

**Step 1: Write failing test (concurrent updates)**
```typescript
it('accurately totals tokens when personas run concurrently', async () => {
  const engine = new WorkshopEngine();
  await Promise.all([
    engine.trackTokens(sessionId, 100),
    engine.trackTokens(sessionId, 200),
    engine.trackTokens(sessionId, 300),
  ]);
  expect(await engine.getTokenTotal(sessionId)).toBe(600);
});
```

**Step 2: Fix with atomic update**
```typescript
async trackTokens(sessionId: string, delta: number) {
  // Use atomic DB increment instead of read-modify-write
  await db.incrementTokens(sessionId, delta);
}
```

If `db.incrementTokens` doesn't exist, add it as an `UPDATE tokens SET count = count + ? WHERE session_id = ?` query.

**Step 3: Commit**
```bash
git commit -m "fix(workshop): use atomic DB increment for trackTokens to fix race (H3)"
```

---

## Wave 3 — Low priority

### Task I: Fix model ID in `endSession` — L1

**Bug:** `endSession` uses `claude-haiku-4-5-20251001` — likely wrong model ID.

**Step 1: Verify correct model ID** in the rest of the codebase or Claude API docs.

**Step 2: Update constant**
```typescript
// Before:
const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

// After (verify correct ID):
const SUMMARY_MODEL = 'claude-haiku-4-5'; // or whatever the canonical ID is
```

**Step 3: Add a smoke test** that verifies `endSession` doesn't throw on model initialization.

**Step 4: Commit**
```bash
git commit -m "fix(workshop): correct model ID used in endSession summary (L1)"
```

---

## Execution Waves Summary

| Wave | Tasks | Parallelizable? |
|------|-------|-----------------|
| 1 | A, C, E, F, G | ✅ Yes — all independent |
| 1.5 | B (after A), D (after C) | Unblocked by Wave 1 |
| 2 | H (after C+D) | Unblocked by Wave 1.5 |
| 3 | I | Any time |
