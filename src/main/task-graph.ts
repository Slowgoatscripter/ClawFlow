import { Task } from '../shared/types'

export interface AdjacencyList {
  [taskId: number]: number[]
}

export interface GraphValidation {
  valid: boolean
  cycle?: number[]
}

export function buildGraph(tasks: Task[]): AdjacencyList {
  const graph: AdjacencyList = {}
  for (const task of tasks) {
    graph[task.id] = task.dependencyIds ?? []
  }
  return graph
}

export function validateNoCycles(graph: AdjacencyList): GraphValidation {
  const visited = new Set<number>()
  const inStack = new Set<number>()
  const path: number[] = []

  function dfs(node: number): number[] | null {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node)
      return path.slice(cycleStart).concat(node)
    }
    if (visited.has(node)) return null

    visited.add(node)
    inStack.add(node)
    path.push(node)

    for (const dep of graph[node] ?? []) {
      const cycle = dfs(dep)
      if (cycle) return cycle
    }

    path.pop()
    inStack.delete(node)
    return null
  }

  for (const nodeStr of Object.keys(graph)) {
    const node = Number(nodeStr)
    const cycle = dfs(node)
    if (cycle) return { valid: false, cycle }
  }

  return { valid: true }
}

export function getReadyTaskIds(
  graph: AdjacencyList,
  taskStatuses: Map<number, string>
): number[] {
  const ready: number[] = []
  for (const [taskIdStr, deps] of Object.entries(graph)) {
    const taskId = Number(taskIdStr)
    const status = taskStatuses.get(taskId)
    if (status !== 'backlog') continue

    const allDepsDone = deps.every((depId) => taskStatuses.get(depId) === 'done')
    if (allDepsDone) ready.push(taskId)
  }
  return ready
}

export function getDependencyChain(graph: AdjacencyList, taskId: number): number[] {
  const chain: number[] = []
  const visited = new Set<number>()

  function collect(id: number): void {
    for (const depId of graph[id] ?? []) {
      if (!visited.has(depId)) {
        visited.add(depId)
        collect(depId)
        chain.push(depId)
      }
    }
  }

  collect(taskId)
  return chain
}

export function isTaskBlocked(
  graph: AdjacencyList,
  taskId: number,
  taskStatuses: Map<number, string>
): { blocked: boolean; blockedBy: number[] } {
  const deps = graph[taskId] ?? []
  const blockedBy = deps.filter((depId) => taskStatuses.get(depId) !== 'done')
  return { blocked: blockedBy.length > 0, blockedBy }
}

// --- Execution Order (Topological Sort) ---

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
}

export interface ExecutionOrderResult {
  global: number[]
  byGroup: Record<number, number[]>
}

export function computeExecutionOrder(tasks: Task[]): ExecutionOrderResult {
  // 1. Filter to non-done tasks
  const active = tasks.filter((t) => t.status !== 'done')
  const activeIds = new Set(active.map((t) => t.id))
  const taskMap = new Map(active.map((t) => [t.id, t]))

  // 2. Build in-degree map (only count deps within active set)
  const inDegree = new Map<number, number>()
  const dependents = new Map<number, number[]>() // dep -> tasks that depend on it

  for (const task of active) {
    inDegree.set(task.id, 0)
    dependents.set(task.id, [])
  }

  for (const task of active) {
    const deps = (task.dependencyIds ?? []).filter((d) => activeIds.has(d))
    inDegree.set(task.id, deps.length)
    for (const dep of deps) {
      dependents.get(dep)!.push(task.id)
    }
  }

  // 3. Kahn's algorithm with sorted frontier
  const compareTasks = (a: number, b: number): number => {
    const ta = taskMap.get(a)!
    const tb = taskMap.get(b)!
    const pa = PRIORITY_RANK[ta.priority] ?? 2
    const pb = PRIORITY_RANK[tb.priority] ?? 2
    if (pa !== pb) return pa - pb
    return ta.createdAt.localeCompare(tb.createdAt)
  }

  // Collect initial frontier (in-degree 0), sort it
  const frontier: number[] = []
  for (const task of active) {
    if (inDegree.get(task.id) === 0) frontier.push(task.id)
  }
  frontier.sort(compareTasks)

  const globalOrder: number[] = []

  while (frontier.length > 0) {
    const current = frontier.shift()!
    globalOrder.push(current)

    for (const dep of dependents.get(current) ?? []) {
      const newDeg = inDegree.get(dep)! - 1
      inDegree.set(dep, newDeg)
      if (newDeg === 0) {
        // Insert into sorted position
        let insertIdx = 0
        while (insertIdx < frontier.length && compareTasks(frontier[insertIdx], dep) <= 0) {
          insertIdx++
        }
        frontier.splice(insertIdx, 0, dep)
      }
    }
  }

  // 4. Build per-group order
  const byGroup: Record<number, number[]> = {}
  for (const id of globalOrder) {
    const task = taskMap.get(id)!
    if (task.groupId != null) {
      if (!byGroup[task.groupId]) byGroup[task.groupId] = []
      byGroup[task.groupId].push(id)
    }
  }

  return { global: globalOrder, byGroup }
}
