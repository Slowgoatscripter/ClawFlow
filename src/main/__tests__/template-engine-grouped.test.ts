import { describe, test, expect } from 'vitest'
import type { Task, WorkOrder } from '../../shared/types'

// ---------------------------------------------------------------------------
// Pure-logic tests for the grouped prompt helpers in template-engine.ts.
// We extract the logic here to test it without Electron/fs dependencies —
// the same pattern used by other test files in this project.
// The real constructGroupedPrompt is tested via its placeholder-filling logic.
// ---------------------------------------------------------------------------

// --- Mirror of formatWorkOrder (private fn in template-engine.ts) ---
function formatWorkOrder(workOrder: WorkOrder): string {
  const sections: string[] = []
  sections.push(`**Objective:** ${workOrder.objective}`)

  if (workOrder.files.length > 0) {
    sections.push('\n**Files:**')
    for (const f of workOrder.files) {
      sections.push(`- \`${f.path}\` (${f.action}): ${f.description}`)
    }
  }

  if (workOrder.patterns.length > 0) {
    sections.push('\n**Patterns to Follow:**')
    for (const p of workOrder.patterns) sections.push(`- ${p}`)
  }

  if (workOrder.integration.length > 0) {
    sections.push('\n**Integration Points:**')
    for (const i of workOrder.integration) sections.push(`- ${i}`)
  }

  if (workOrder.constraints.length > 0) {
    sections.push('\n**Constraints:**')
    for (const c of workOrder.constraints) sections.push(`- ${c}`)
  }

  if (workOrder.tests.length > 0) {
    sections.push('\n**Expected Tests:**')
    for (const t of workOrder.tests) sections.push(`- ${t}`)
  }

  return sections.join('\n')
}

// --- Mirror of formatSiblingTasks (private fn in template-engine.ts) ---
function formatSiblingTasks(tasks: Task[], currentTaskId: number): string {
  const siblings = tasks.filter(t => t.id !== currentTaskId)
  if (siblings.length === 0) return 'No sibling tasks.'

  return siblings.map(t => {
    const files = t.workOrder?.files.map(f => `\`${f.path}\``).join(', ') ?? 'unknown'
    return `- **${t.title}** (Task #${t.id}): Files: ${files}`
  }).join('\n')
}

// --- Mirror of the placeholder-filling portion of constructGroupedPrompt ---
function applyGroupedPlaceholders(
  template: string,
  task: Task,
  groupSharedContext: string,
  siblingTasks: Task[]
): string {
  let result = template
  result = result.replaceAll('{{work_order}}', task.workOrder ? formatWorkOrder(task.workOrder) : 'No work order provided.')
  result = result.replaceAll('{{shared_context}}', groupSharedContext)
  result = result.replaceAll('{{sibling_tasks}}', formatSiblingTasks(siblingTasks, task.id))
  return result
}

// Helper to build a minimal valid Task
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Test Task',
    description: 'A test task',
    tier: 'L1',
    status: 'implementing',
    priority: 'medium',
    autoMode: false,
    createdAt: '2024-01-01T00:00:00Z',
    startedAt: null,
    completedAt: null,
    currentAgent: null,
    brainstormOutput: null,
    designReview: null,
    plan: null,
    planReviewCount: 0,
    implementationNotes: null,
    reviewComments: null,
    reviewScore: null,
    implReviewCount: 0,
    testResults: null,
    verifyResult: null,
    commitHash: null,
    branchName: null,
    worktreePath: null,
    prUrl: null,
    handoffs: [],
    agentLog: [],
    todos: null,
    archivedAt: null,
    pausedFromStatus: null,
    pauseReason: null,
    activeSessionId: null,
    autoMerge: false,
    richHandoff: null,
    dependencyIds: [],
    artifacts: null,
    groupId: 42,
    workOrder: null,
    assignedSkill: null,
    ...overrides,
  }
}

function makeWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    objective: 'Implement the auth module',
    files: [],
    patterns: [],
    integration: [],
    constraints: [],
    tests: [],
    ...overrides,
  }
}

const TEMPLATE = `## Work Order\n\n{{work_order}}\n\n## Context\n\n{{shared_context}}\n\n## Siblings\n\n{{sibling_tasks}}`

// --- formatWorkOrder tests ---

describe('formatWorkOrder', () => {
  test('includes the objective', () => {
    const wo = makeWorkOrder({ objective: 'Build the login form' })
    const result = formatWorkOrder(wo)
    expect(result).toContain('**Objective:** Build the login form')
  })

  test('does not include Files section when files array is empty', () => {
    const wo = makeWorkOrder({ files: [] })
    const result = formatWorkOrder(wo)
    expect(result).not.toContain('**Files:**')
  })

  test('includes Files section with path, action, and description', () => {
    const wo = makeWorkOrder({
      files: [{ path: 'src/api/handler.ts', action: 'modify', description: 'Add new endpoint' }],
    })
    const result = formatWorkOrder(wo)
    expect(result).toContain('**Files:**')
    expect(result).toContain('`src/api/handler.ts` (modify): Add new endpoint')
  })

  test('includes multiple files', () => {
    const wo = makeWorkOrder({
      files: [
        { path: 'src/a.ts', action: 'create', description: 'Create A' },
        { path: 'src/b.ts', action: 'modify', description: 'Modify B' },
      ],
    })
    const result = formatWorkOrder(wo)
    expect(result).toContain('`src/a.ts` (create): Create A')
    expect(result).toContain('`src/b.ts` (modify): Modify B')
  })

  test('includes Patterns to Follow section', () => {
    const wo = makeWorkOrder({ patterns: ['Use repository pattern', 'Validate with Zod'] })
    const result = formatWorkOrder(wo)
    expect(result).toContain('**Patterns to Follow:**')
    expect(result).toContain('- Use repository pattern')
    expect(result).toContain('- Validate with Zod')
  })

  test('omits Patterns section when empty', () => {
    const wo = makeWorkOrder({ patterns: [] })
    const result = formatWorkOrder(wo)
    expect(result).not.toContain('**Patterns to Follow:**')
  })

  test('includes Integration Points section', () => {
    const wo = makeWorkOrder({ integration: ['Calls UserService.getById'] })
    const result = formatWorkOrder(wo)
    expect(result).toContain('**Integration Points:**')
    expect(result).toContain('- Calls UserService.getById')
  })

  test('omits Integration section when empty', () => {
    const wo = makeWorkOrder({ integration: [] })
    const result = formatWorkOrder(wo)
    expect(result).not.toContain('**Integration Points:**')
  })

  test('includes Constraints section', () => {
    const wo = makeWorkOrder({ constraints: ['Max 200 lines per file'] })
    const result = formatWorkOrder(wo)
    expect(result).toContain('**Constraints:**')
    expect(result).toContain('- Max 200 lines per file')
  })

  test('omits Constraints section when empty', () => {
    const wo = makeWorkOrder({ constraints: [] })
    const result = formatWorkOrder(wo)
    expect(result).not.toContain('**Constraints:**')
  })

  test('includes Expected Tests section', () => {
    const wo = makeWorkOrder({ tests: ['Should return 401 for unauthenticated requests'] })
    const result = formatWorkOrder(wo)
    expect(result).toContain('**Expected Tests:**')
    expect(result).toContain('- Should return 401 for unauthenticated requests')
  })

  test('omits Expected Tests section when empty', () => {
    const wo = makeWorkOrder({ tests: [] })
    const result = formatWorkOrder(wo)
    expect(result).not.toContain('**Expected Tests:**')
  })

  test('includes all sections when all fields are populated', () => {
    const wo = makeWorkOrder({
      objective: 'Build auth',
      files: [{ path: 'src/auth.ts', action: 'create', description: 'Auth module' }],
      patterns: ['Use DI'],
      integration: ['Calls DB'],
      constraints: ['No console.log'],
      tests: ['Returns 200 on success'],
    })
    const result = formatWorkOrder(wo)
    expect(result).toContain('**Objective:**')
    expect(result).toContain('**Files:**')
    expect(result).toContain('**Patterns to Follow:**')
    expect(result).toContain('**Integration Points:**')
    expect(result).toContain('**Constraints:**')
    expect(result).toContain('**Expected Tests:**')
  })
})

// --- formatSiblingTasks tests ---

describe('formatSiblingTasks', () => {
  test('returns "No sibling tasks." when no tasks remain after filtering', () => {
    const task = makeTask({ id: 1 })
    expect(formatSiblingTasks([], 1)).toBe('No sibling tasks.')
    expect(formatSiblingTasks([task], 1)).toBe('No sibling tasks.')
  })

  test('excludes the current task from sibling list', () => {
    const current = makeTask({ id: 1, title: 'Current' })
    const sibling = makeTask({ id: 2, title: 'Sibling' })
    const result = formatSiblingTasks([current, sibling], 1)
    expect(result).not.toContain('Current')
    expect(result).toContain('Sibling')
  })

  test('lists sibling title, id, and file paths from work order', () => {
    const sibling = makeTask({
      id: 2,
      title: 'Auth Handler',
      workOrder: makeWorkOrder({
        files: [{ path: 'src/auth/handler.ts', action: 'create', description: 'Handler' }],
      }),
    })
    const result = formatSiblingTasks([sibling], 99)
    expect(result).toContain('**Auth Handler** (Task #2)')
    expect(result).toContain('`src/auth/handler.ts`')
  })

  test('shows "unknown" for files when task has no work order', () => {
    const sibling = makeTask({ id: 3, title: 'No Work Order Task', workOrder: null })
    const result = formatSiblingTasks([sibling], 1)
    expect(result).toContain('unknown')
  })

  test('lists multiple siblings on separate lines', () => {
    const s1 = makeTask({ id: 2, title: 'Task Two' })
    const s2 = makeTask({ id: 3, title: 'Task Three' })
    const result = formatSiblingTasks([s1, s2], 1)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Task Two')
    expect(lines[1]).toContain('Task Three')
  })
})

// --- applyGroupedPlaceholders (proxy for constructGroupedPrompt filling logic) tests ---

describe('applyGroupedPlaceholders (constructGroupedPrompt placeholder logic)', () => {
  test('replaces {{work_order}} with formatted work order', () => {
    const task = makeTask({ workOrder: makeWorkOrder({ objective: 'Build login' }) })
    const result = applyGroupedPlaceholders(TEMPLATE, task, 'ctx', [])
    expect(result).toContain('**Objective:** Build login')
    expect(result).not.toContain('{{work_order}}')
  })

  test('replaces {{work_order}} with fallback when work order is null', () => {
    const task = makeTask({ workOrder: null })
    const result = applyGroupedPlaceholders(TEMPLATE, task, 'ctx', [])
    expect(result).toContain('No work order provided.')
    expect(result).not.toContain('{{work_order}}')
  })

  test('replaces {{shared_context}} with provided context string', () => {
    const task = makeTask()
    const result = applyGroupedPlaceholders(TEMPLATE, task, 'The design doc summary', [])
    expect(result).toContain('The design doc summary')
    expect(result).not.toContain('{{shared_context}}')
  })

  test('replaces {{sibling_tasks}} with sibling listing', () => {
    const current = makeTask({ id: 1 })
    const sibling = makeTask({ id: 2, title: 'Peer Task' })
    const result = applyGroupedPlaceholders(TEMPLATE, current, 'ctx', [current, sibling])
    expect(result).toContain('Peer Task')
    expect(result).not.toContain('{{sibling_tasks}}')
  })

  test('replaces {{sibling_tasks}} with no-sibling message when only current task is passed', () => {
    const task = makeTask({ id: 5 })
    const result = applyGroupedPlaceholders(TEMPLATE, task, 'ctx', [task])
    expect(result).toContain('No sibling tasks.')
    expect(result).not.toContain('{{sibling_tasks}}')
  })

  test('no placeholder tokens remain in the output', () => {
    const task = makeTask({
      workOrder: makeWorkOrder({
        files: [{ path: 'src/foo.ts', action: 'create', description: 'Foo' }],
      }),
    })
    const sibling = makeTask({ id: 2, title: 'Other Task', workOrder: makeWorkOrder() })
    const result = applyGroupedPlaceholders(TEMPLATE, task, 'context', [task, sibling])
    expect(result).not.toContain('{{work_order}}')
    expect(result).not.toContain('{{shared_context}}')
    expect(result).not.toContain('{{sibling_tasks}}')
  })
})
