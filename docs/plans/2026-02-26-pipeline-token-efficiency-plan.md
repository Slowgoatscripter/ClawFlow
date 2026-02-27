# Pipeline Token Efficiency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce pipeline token costs by 50-70% through a continuous agent architecture and prompt efficiency fixes.

**Architecture:** Replace per-stage agent spawning with a single continuous agent that receives stage transition messages. Add pre-stage context budget checks with rich handoff documents when context runs low. Trim prompt bloat by removing redundant injections, metadata noise, and duplicate content.

**Tech Stack:** Electron, TypeScript, Claude SDK (`@anthropic-ai/claude-code`), SQLite (better-sqlite3)

---

## Phase 1: Prompt Efficiency Fixes (Items 1-8)

These are independent of the continuous agent work and provide immediate savings.

---

### Task 1: Strip metadata noise from injected outputs

**Files:**
- Modify: `src/main/template-engine.ts:28-47` (fillTemplate function)

**Step 1: Edit the fillTemplate replacements**

Change lines 38-43 in `fillTemplate()` to extract only `.output` from JSON-wrapped stage outputs instead of serializing the full object:

```typescript
// BEFORE (lines 38-43):
'{{design_review}}': task.designReview ? JSON.stringify(task.designReview, null, 2) : 'N/A',
'{{plan}}': task.plan ? JSON.stringify(task.plan, null, 2) : 'N/A',
'{{implementation_notes}}': task.implementationNotes ? JSON.stringify(task.implementationNotes, null, 2) : 'N/A',
'{{review_comments}}': task.reviewComments ? JSON.stringify(task.reviewComments, null, 2) : 'N/A',
'{{review_score}}': task.reviewScore?.toString() ?? 'N/A',
'{{test_results}}': task.testResults ? JSON.stringify(task.testResults, null, 2) : 'N/A',

// AFTER:
'{{design_review}}': extractOutput(task.designReview),
'{{plan}}': extractOutput(task.plan),
'{{implementation_notes}}': extractOutput(task.implementationNotes),
'{{review_comments}}': extractOutput(task.reviewComments),
'{{review_score}}': task.reviewScore?.toString() ?? 'N/A',
'{{test_results}}': extractOutput(task.testResults),
```

Add helper function above `fillTemplate()`:

```typescript
function extractOutput(field: unknown): string {
  if (!field) return 'N/A'
  if (typeof field === 'string') return field
  if (typeof field === 'object' && field !== null && 'output' in field) {
    return (field as { output: string }).output
  }
  return JSON.stringify(field)
}
```

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/main/template-engine.ts
git commit -m "perf: strip metadata noise from injected stage outputs"
```

---

### Task 2: Remove brainstorm re-injection in L3 plan stage

**Files:**
- Modify: `src/main/template-engine.ts:28-47` (fillTemplate — tier-aware brainstorm injection)
- Modify: `src/templates/plan-agent.md:20` (template reference to brainstorm_output)

**Step 1: Make brainstorm injection tier-aware in fillTemplate**

The `fillTemplate` function needs access to the task tier. It already receives the full task object. Change the `{{brainstorm_output}}` mapping:

```typescript
// BEFORE (line 37):
'{{brainstorm_output}}': task.brainstormOutput ?? 'N/A',

// AFTER:
'{{brainstorm_output}}': task.brainstormOutput ?? 'N/A',
'{{brainstorm_reference}}': 'Brainstorm output was reviewed in the design_review stage. See previous handoff for decisions and requirements.',
```

**Step 2: Update plan-agent.md to use reference for L3**

In `src/templates/plan-agent.md`, replace the brainstorm output section. The template itself can't be tier-conditional, so we use a different approach — add both variables and let fillTemplate control which has content:

Change line 20 area in plan-agent.md from:
```markdown
## Brainstorm Output
{{brainstorm_output}}
```

To:
```markdown
## Prior Context
{{brainstorm_context}}
```

Then in fillTemplate, add a new computed variable:

```typescript
'{{brainstorm_context}}': (() => {
  // For L3, the design review already covers the brainstorm — use a brief reference
  if (task.tier === 'L3' && task.designReview) {
    return 'Brainstorm output was reviewed in the design_review stage. See previous handoff for decisions and requirements.'
  }
  // For L2 or if no design review yet, include the full brainstorm
  return task.brainstormOutput ?? 'N/A'
})(),
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/template-engine.ts src/templates/plan-agent.md
git commit -m "perf: skip brainstorm re-injection in L3 plan stage"
```

---

### Task 3: Replace full outputs with handoff summaries in code_review

**Files:**
- Modify: `src/templates/code-review-agent.md:19,23` (replace implementation_notes and plan references)
- Modify: `src/main/template-engine.ts:28-47` (add handoff summary variables)

**Step 1: Add handoff summary variables to fillTemplate**

Add computed variables that extract just the handoff summaries for relevant stages:

```typescript
'{{plan_summary}}': (() => {
  const planHandoff = task.handoffs?.find((h: any) => h.stage === 'plan')
  if (planHandoff) {
    return `**Plan Summary:** ${planHandoff.summary}\n**Key Decisions:** ${planHandoff.keyDecisions ?? 'N/A'}\n**Files to Modify:** ${planHandoff.filesModified ?? 'N/A'}`
  }
  return extractOutput(task.plan)
})(),
'{{implementation_summary}}': (() => {
  const implHandoff = task.handoffs?.find((h: any) => h.stage === 'implement')
  if (implHandoff) {
    return `**Implementation Summary:** ${implHandoff.summary}\n**Key Decisions:** ${implHandoff.keyDecisions ?? 'N/A'}\n**Files Modified:** ${implHandoff.filesModified ?? 'N/A'}`
  }
  return extractOutput(task.implementationNotes)
})(),
```

**Step 2: Update code-review-agent.md**

Replace the plan and implementation_notes sections:

```markdown
## Plan Reference
{{plan_summary}}

> Use Read and Grep tools to inspect the actual code rather than relying solely on this summary.

## Implementation Reference
{{implementation_summary}}

> Review the actual code changes in the worktree. Use `git diff` to see what changed.
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/template-engine.ts src/templates/code-review-agent.md
git commit -m "perf: use handoff summaries instead of full outputs in code review"
```

---

### Task 4: Replace full implementation_notes with handoff summary in verify

**Files:**
- Modify: `src/templates/verify-agent.md:18` (replace implementation_notes reference)

**Step 1: Update verify-agent.md**

Replace the implementation notes section (around line 18):

```markdown
## Implementation Reference
{{implementation_summary}}

> Run the tests and read the actual code to verify correctness. Do not rely solely on this summary.
```

The `{{implementation_summary}}` variable was already added in Task 3.

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/templates/verify-agent.md
git commit -m "perf: use handoff summary instead of full impl output in verify"
```

---

### Task 5: Skip _handoff.md for templates with inline handoff instructions

**Files:**
- Modify: `src/main/template-engine.ts:10-25` (loadTemplate function)

**Step 1: Add skip list and conditional append**

```typescript
// Templates that have their own inline handoff instructions
const SKIP_HANDOFF_TEMPLATES = ['design-review-agent', 'completion-agent']

export function loadTemplate(stage: string): string {
  const templatePath = path.join(TEMPLATES_DIR, `${stage}-agent.md`)
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`)
  }
  let template = fs.readFileSync(templatePath, 'utf-8')

  // Only append _handoff.md for templates that don't have inline handoff instructions
  const templateName = `${stage}-agent`
  if (!SKIP_HANDOFF_TEMPLATES.includes(templateName)) {
    const handoffPath = path.join(TEMPLATES_DIR, '_handoff.md')
    if (fs.existsSync(handoffPath)) {
      template += '\n\n' + fs.readFileSync(handoffPath, 'utf-8')
    }
  }

  return template
}
```

Note: The stage names passed to loadTemplate use underscores (e.g., `design_review`), so adjust the skip list to match:

```typescript
const SKIP_HANDOFF_STAGES = ['design_review', 'completion']
// ...
if (!SKIP_HANDOFF_STAGES.includes(stage)) {
```

**Step 2: Verify the completion-agent.md template has adequate handoff instructions inline**

Read completion-agent.md to confirm it has its own output format. If it relies on _handoff.md for the HANDOFF format, keep it in the append list and only skip for design_review.

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/template-engine.ts
git commit -m "perf: skip _handoff.md append for templates with inline handoff"
```

---

### Task 6: Switch to compact JSON for remaining serializations

**Files:**
- Modify: `src/main/template-engine.ts` (any remaining JSON.stringify calls)
- Modify: `src/main/pipeline-engine.ts` (storeStageOutput if it uses pretty-print)

**Step 1: Audit remaining JSON.stringify calls**

After Task 1 removed most `JSON.stringify(x, null, 2)` from fillTemplate, check for any remaining instances in both files. Replace `JSON.stringify(x, null, 2)` with `JSON.stringify(x)` wherever the output is consumed by an agent prompt (not by the UI or DB storage — those can keep pretty-print for readability).

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/main/template-engine.ts src/main/pipeline-engine.ts
git commit -m "perf: use compact JSON for prompt-injected serializations"
```

---

### Task 7: Remove double timestamp signatures from templates

**Files:**
- Modify: `src/templates/brainstorm-agent.md` (remove bottom signature ~line 27)
- Modify: `src/templates/plan-agent.md` (remove bottom signature ~line 31)
- Modify: `src/templates/implement-agent.md` (remove bottom signature ~line 32)
- Modify: `src/templates/code-review-agent.md` (remove bottom signature ~line 49)
- Modify: `src/templates/verify-agent.md` (remove bottom signature ~line 42)
- Modify: `src/templates/completion-agent.md` (remove bottom signature ~line 31)

**Step 1: Remove the "Sign your work" lines from each template**

In each template, find and remove the line matching:
```
Sign your work: > **AgentName** `model` · {{timestamp}}
```

Keep the top signature line (the agent identity header).

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/templates/
git commit -m "perf: remove duplicate timestamp signatures from templates"
```

---

### Task 8: Remove Skill Requirement boilerplate from templates

**Files:**
- Modify: `src/templates/brainstorm-agent.md` (remove `## Skill Requirement` section ~line 7)
- Modify: `src/templates/plan-agent.md` (remove section ~line 7)
- Modify: `src/templates/implement-agent.md` (remove section ~line 7)
- Modify: `src/templates/design-review-agent.md` (remove section ~line 7)
- Modify: `src/templates/code-review-agent.md` (remove section ~line 7)
- Modify: `src/templates/verify-agent.md` (remove section ~line 7)
- Modify: `src/templates/completion-agent.md` (remove section ~line 7)

**Step 1: Remove the Skill Requirement section from each template**

In each template, find and remove the block:
```markdown
## Skill Requirement
Skill instructions for this stage are appended below. Follow them exactly.
```

The skill content is already appended by `constructPrompt()` in template-engine.ts:112-114. This boilerplate adds nothing.

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/templates/
git commit -m "perf: remove redundant skill requirement boilerplate from templates"
```

---

## Phase 2: Continuous Agent Architecture

---

### Task 9: Add session persistence to the task DB schema

**Files:**
- Modify: `src/main/db.ts:109-139` (add active_session_id column)
- Modify: `src/main/db.ts` (add migration for existing databases)

**Step 1: Add column to CREATE TABLE**

Add `active_session_id TEXT` to the tasks table schema (around line 135):

```sql
active_session_id TEXT,
```

**Step 2: Add migration**

In the migrations section of db.ts, add a migration to add the column to existing databases:

```typescript
this.addColumnIfNotExists('tasks', 'active_session_id', 'TEXT')
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: add active_session_id column to tasks table"
```

---

### Task 10: Add context tracking to SDK manager

**Files:**
- Modify: `src/main/sdk-manager.ts` (expose context token usage from SDK results)

**Step 1: Ensure the SDK runner result includes context usage**

The SDK manager already tracks `contextTokens` at lines 303-304. Verify this value is included in the returned result object. If not, add it:

```typescript
// In the result object construction (around line 308-315):
return {
  output: resultText,
  cost: totalCost,
  sessionId,
  numTurns,
  contextTokens,  // Add this if not already present
  contextMax,      // Add this — the 200_000 limit
}
```

**Step 2: Update the SdkRunnerResult type** (if one exists) to include `contextTokens` and `contextMax`

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/sdk-manager.ts
git commit -m "feat: expose context token counts from SDK runner results"
```

---

### Task 11: Implement context budget checker

**Files:**
- Create: `src/main/context-budget.ts`

**Step 1: Write the context budget checker**

```typescript
import { PipelineStage } from '../shared/types'

// Estimated token budget per stage based on maxTurns and typical usage
const STAGE_BUDGETS: Record<PipelineStage, number> = {
  brainstorm: 15_000,
  design_review: 20_000,
  plan: 10_000,
  implement: 60_000,
  code_review: 15_000,
  verify: 10_000,
  done: 5_000,
}

const SAFETY_MARGIN = 1.2 // 20% safety margin

export interface ContextBudgetCheck {
  canContinue: boolean
  currentUsage: number
  contextMax: number
  estimatedNeed: number
  remainingContext: number
  usagePercent: number
}

export function checkContextBudget(
  currentUsage: number,
  contextMax: number,
  nextStage: PipelineStage
): ContextBudgetCheck {
  const estimatedNeed = STAGE_BUDGETS[nextStage] * SAFETY_MARGIN
  const remainingContext = contextMax - currentUsage
  const canContinue = remainingContext >= estimatedNeed
  const usagePercent = Math.round((currentUsage / contextMax) * 100)

  return {
    canContinue,
    currentUsage,
    contextMax,
    estimatedNeed,
    remainingContext,
    usagePercent,
  }
}
```

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/main/context-budget.ts
git commit -m "feat: add context budget checker for stage transitions"
```

---

### Task 12: Create rich handoff template

**Files:**
- Create: `src/templates/_rich-handoff.md`

**Step 1: Write the rich handoff template**

```markdown
## Context Handoff Required

The context window is approaching capacity. Before this session ends, produce a **Rich Handoff Document** so the next agent can continue without re-exploring the codebase.

Structure your handoff as follows:

### RICH_HANDOFF

#### Pipeline State
- **Completed stages:** List each completed stage and its key outcome (1-2 sentences each)
- **Next stage:** {{next_stage}}
- **User feedback received:** Summarize any rejections or feedback from the user

#### Codebase Knowledge Map
- **Project structure:** List the key directories and their purposes
- **Key files explored:** For each file you read, provide: path, purpose, approximate size, key functions/exports
- **Architecture patterns:** Describe the patterns you identified (frameworks, communication patterns, data flow)
- **Dependencies:** List key dependencies relevant to this task

#### Working State
- **What was accomplished:** Concrete outputs produced so far
- **What comes next:** Specific actions the next stage needs to take
- **Files modified:** List all files changed in the worktree with brief descriptions of changes
- **Open questions:** Anything unresolved that needs attention
- **Gotchas/warnings:** Problems or non-obvious constraints discovered

Keep each section concise but complete. The goal is ~2,000-5,000 tokens total — enough to skip codebase exploration, not a full context dump.
```

**Step 2: Commit**

```bash
git add src/templates/_rich-handoff.md
git commit -m "feat: add rich handoff template for context-limit transitions"
```

---

### Task 13: Implement continuous agent session management in pipeline engine

**Files:**
- Modify: `src/main/pipeline-engine.ts` (major refactor of runStage and stage transition logic)

This is the core architectural change. The pipeline engine needs to:

1. Track whether an active session exists for a task
2. On stage transition, decide: inject continuation into existing session vs. start new session
3. Check context budget before each stage
4. Handle the rich handoff flow when context is insufficient

**Step 1: Add context tracking state to PipelineEngine class**

Around line 77, alongside the existing `sessionIds` Map:

```typescript
private sessionIds = new Map<number, string>()
private contextUsage = new Map<number, { tokens: number; max: number }>()
```

**Step 2: Update runStage to support continuation mode**

The current `runStage` always constructs a fresh prompt and starts a new SDK session. Refactor it to:

```typescript
private async runStage(
  taskId: number,
  stage: PipelineStage,
  feedback?: string,
  resumeSessionId?: string,
  userResponse?: string
): Promise<void> {
  const task = this.db.getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const stageConfig = getEffectiveStageConfig(stage, /* ... */)

  // Determine if we should continue an existing session or start fresh
  const existingSessionId = task.activeSessionId
  const isFirstStage = stage === getFirstStage(task.tier)
  const isContinuation = existingSessionId && !isFirstStage && !resumeSessionId

  let prompt: string

  if (isContinuation) {
    // Inject a stage transition message into the existing session
    prompt = constructContinuationPrompt(stage, task, this.projectPath)
  } else {
    // Fresh session — full prompt with any rich handoff context
    prompt = constructPrompt(stage, task, this.projectPath)
  }

  // Run SDK with continuation or fresh session
  const sdkPromise = this.sdkRunner({
    prompt,
    model: stageConfig.model,
    maxTurns: stageConfig.maxTurns,
    cwd: task.worktreePath || this.projectPath,
    resumeSessionId: isContinuation ? existingSessionId : resumeSessionId,
    // ... other params
  })

  // ... rest of stage execution (timeout, result handling, handoff parsing)

  // After result, store context usage
  if (result.contextTokens !== undefined) {
    this.contextUsage.set(taskId, {
      tokens: result.contextTokens,
      max: result.contextMax || 200_000,
    })
  }

  // Persist the session ID for continuation
  if (result.sessionId) {
    this.db.updateTask(taskId, { activeSessionId: result.sessionId })
    this.sessionIds.set(taskId, result.sessionId)
  }
}
```

**Step 3: Add context budget check to stage advancement logic**

In the stage advancement block (lines 576-598), before advancing to the next stage:

```typescript
// After parseHandoff, before advancing to next stage:
const nextStage = getNextStage(task.tier, stage)

if (nextStage && nextStage !== 'done') {
  const contextState = this.contextUsage.get(taskId)

  if (contextState) {
    const budgetCheck = checkContextBudget(
      contextState.tokens,
      contextState.max,
      nextStage
    )

    if (!budgetCheck.canContinue) {
      // Trigger rich handoff flow
      this.emit('stage:context_handoff', {
        taskId,
        currentStage: stage,
        nextStage,
        usagePercent: budgetCheck.usagePercent,
        remainingTokens: budgetCheck.remainingContext,
        estimatedNeed: budgetCheck.estimatedNeed,
      })

      // Pause for user approval before handoff
      // The approveContextHandoff method will clear the session and restart
      return
    }
  }
}

// Continue with existing stage advancement logic...
```

**Step 4: Add context handoff approval method**

```typescript
async approveContextHandoff(taskId: number): Promise<void> {
  const task = this.db.getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  // Request rich handoff from current session
  const richHandoffPrompt = loadRichHandoffTemplate(task.currentAgent as PipelineStage)

  // Send the rich handoff request into the existing session
  const result = await this.sdkRunner({
    prompt: richHandoffPrompt,
    resumeSessionId: task.activeSessionId,
    maxTurns: 5,
    // ... config
  })

  // Store the rich handoff
  const richHandoff = result.output
  this.db.updateTask(taskId, { richHandoff })

  // Clear the active session — next runStage will start fresh
  this.db.updateTask(taskId, { activeSessionId: null })
  this.sessionIds.delete(taskId)
  this.contextUsage.delete(taskId)

  // Continue pipeline with next stage (fresh session, rich handoff in prompt)
  const nextStage = getNextStage(task.tier, task.currentAgent as PipelineStage)
  if (nextStage) {
    await this.runStage(taskId, nextStage)
  }
}
```

**Step 5: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 6: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat: implement continuous agent with stage-boundary context handoffs"
```

---

### Task 14: Create continuation prompt constructor

**Files:**
- Modify: `src/main/template-engine.ts` (add constructContinuationPrompt function)

**Step 1: Add the continuation prompt builder**

This constructs a lightweight prompt for injecting into an existing session. It contains only the new stage's template and skill — no prior outputs (already in context).

```typescript
export function constructContinuationPrompt(
  stage: PipelineStage,
  task: Task,
  projectPath: string
): string {
  const config = STAGE_CONFIGS[stage]
  const template = loadTemplate(stage)

  // For continuation, we only fill minimal variables — prior outputs are already in context
  const minimalReplacements: Record<string, string> = {
    '{{title}}': task.title,
    '{{description}}': task.description,
    '{{tier}}': task.tier,
    '{{priority}}': task.priority,
    '{{timestamp}}': new Date().toISOString(),
    '{{project_path}}': projectPath,
    '{{platform}}': process.platform,
    // Prior stage outputs are NOT included — they're already in the conversation
    '{{brainstorm_output}}': '[Already in context from prior stage]',
    '{{design_review}}': '[Already in context from prior stage]',
    '{{plan}}': '[Already in context from prior stage]',
    '{{implementation_notes}}': '[Already in context from prior stage]',
    '{{review_comments}}': '[Already in context from prior stage]',
    '{{review_score}}': '[Already in context from prior stage]',
    '{{test_results}}': '[Already in context from prior stage]',
    '{{verify_result}}': '[Already in context from prior stage]',
    '{{previous_handoff}}': '[Already in context — you just produced this handoff]',
    '{{handoff_chain}}': '[Already in context from prior stages]',
  }

  let prompt = template
  for (const [key, value] of Object.entries(minimalReplacements)) {
    prompt = prompt.replaceAll(key, value)
  }

  // Append skill content
  if (config.skill) {
    const skillContent = loadSkillContent(config.skill)
    if (skillContent) {
      prompt += `\n\n---\n\n## Skill Instructions: ${config.skill}\n\n${skillContent}`
    }
  }

  // Prepend a stage transition header
  const header = `\n\n---\n# STAGE TRANSITION: You are now entering the \`${stage}\` stage.\nYour prior work is already in this conversation. Continue building on it.\n---\n\n`

  return header + prompt
}
```

**Step 2: Export the function**

Ensure it's exported from template-engine.ts.

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/template-engine.ts
git commit -m "feat: add continuation prompt constructor for stage transitions"
```

---

### Task 15: Add rich handoff injection to constructPrompt for post-handoff sessions

**Files:**
- Modify: `src/main/template-engine.ts:105-115` (constructPrompt function)
- Modify: `src/main/db.ts` (add rich_handoff column)

**Step 1: Add rich_handoff column to DB**

```sql
rich_handoff TEXT
```

Add migration: `this.addColumnIfNotExists('tasks', 'rich_handoff', 'TEXT')`

**Step 2: Modify constructPrompt to inject rich handoff when present**

In `constructPrompt()`, after the normal prompt assembly, check if a rich handoff exists and prepend it:

```typescript
export function constructPrompt(
  stage: PipelineStage,
  task: Task,
  projectPath: string
): string {
  // ... existing template loading and filling ...

  // If there's a rich handoff from a previous session, inject it
  if (task.richHandoff) {
    const handoffContext = `\n\n---\n## Context from Previous Session\n\nA prior agent worked on this task but reached context limits. Here is their knowledge transfer:\n\n${task.richHandoff}\n\n---\n\n`
    prompt = handoffContext + prompt
  }

  // ... existing skill append ...

  return prompt
}
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/template-engine.ts src/main/db.ts
git commit -m "feat: inject rich handoff context into post-handoff session prompts"
```

---

### Task 16: Wire up context handoff events to IPC and renderer

**Files:**
- Modify: `src/main/ipc-handlers.ts` (add context handoff IPC handlers)
- Modify: `src/preload/index.ts` (expose context handoff methods)
- Modify: `src/renderer/src/stores/` (handle context handoff state in relevant store)

**Step 1: Add IPC handler for context handoff approval**

In ipc-handlers.ts:

```typescript
ipcMain.handle('pipeline:approveContextHandoff', async (_event, taskId: number) => {
  await pipelineEngine.approveContextHandoff(taskId)
})
```

**Step 2: Forward the stage:context_handoff event to the renderer**

In the pipeline engine event wiring:

```typescript
pipelineEngine.on('stage:context_handoff', (data) => {
  mainWindow.webContents.send('pipeline:contextHandoff', data)
})
```

**Step 3: Expose in preload**

```typescript
approveContextHandoff: (taskId: number) => ipcRenderer.invoke('pipeline:approveContextHandoff', taskId),
onContextHandoff: (callback: (data: any) => void) => {
  ipcRenderer.on('pipeline:contextHandoff', (_event, data) => callback(data))
},
```

**Step 4: Handle in renderer store/UI**

Add the context handoff as a new notification type in the task detail view. When received, show a prompt:

> "Context is at X% capacity. The next stage (Y) needs more room. Approve handoff to a fresh agent?"
> [Approve] [Cancel]

The Approve button calls `window.api.approveContextHandoff(taskId)`.

**Step 5: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 6: Commit**

```bash
git add src/main/ipc-handlers.ts src/preload/index.ts src/renderer/src/
git commit -m "feat: wire context handoff events through IPC to renderer"
```

---

### Task 17: Clear active session on task reset/rejection

**Files:**
- Modify: `src/main/pipeline-engine.ts` (update rejectStage and reset logic)

**Step 1: Clear session on rejection that restarts a stage**

In `rejectStage()` (line 271), when a stage is re-run after rejection, the session should NOT continue from the old context. Clear the active session:

```typescript
// In rejectStage, after deciding to re-run:
this.db.updateTask(taskId, { activeSessionId: null })
this.sessionIds.delete(taskId)
this.contextUsage.delete(taskId)
```

**Step 2: Clear session on task reset/cancel**

Ensure `cancelTask()`, `resetTask()`, or any method that restarts the pipeline also clears the active session.

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "fix: clear active session on stage rejection and task reset"
```

---

### Task 18: Final build verification and integration test

**Files:**
- All modified files

**Step 1: Full build**

Run: `npm run build`
Expected: Clean compilation with zero errors

**Step 2: Verify the app starts**

Run: `npm run dev`
Expected: App launches without errors in console

**Step 3: Manual smoke test**

1. Create an L1 task — verify it runs through plan → implement → done in a single agent session
2. Check that stage outputs appear correctly (no JSON metadata noise)
3. Verify the session continues across stage boundaries (check logs for session ID reuse)

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: integration fixes for continuous agent pipeline"
```

---

## Task Dependency Summary

```
Phase 1 (prompt fixes): Tasks 1-8 are independent of each other, can run in parallel
Phase 2 (continuous agent):
  Task 9 (DB schema) → Task 13 (pipeline engine refactor)
  Task 10 (SDK context tracking) → Task 11 (budget checker) → Task 13
  Task 12 (rich handoff template) → Task 13
  Task 13 → Task 14 (continuation prompt)
  Task 13 → Task 15 (rich handoff injection)
  Task 13 → Task 16 (IPC wiring)
  Task 13 → Task 17 (session cleanup)
  All → Task 18 (integration test)
```

**Estimated total: 18 tasks across 2 phases.**
Phase 1 can be done in parallel. Phase 2 has a dependency chain through Task 13.
