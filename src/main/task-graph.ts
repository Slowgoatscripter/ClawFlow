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
