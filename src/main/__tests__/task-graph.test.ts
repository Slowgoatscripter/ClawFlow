import { describe, test, expect } from 'vitest'
import {
  buildGraph,
  validateNoCycles,
  getReadyTaskIds,
  getDependencyChain,
  isTaskBlocked
} from '../task-graph'
import { Task } from '../../shared/types'

function makeTask(id: number, deps: number[] = []): Partial<Task> {
  return { id, dependencyIds: deps } as Partial<Task>
}

describe('TaskGraph', () => {
  describe('buildGraph', () => {
    test('creates adjacency list from tasks', () => {
      const tasks = [makeTask(1), makeTask(2, [1]), makeTask(3, [1, 2])]
      const graph = buildGraph(tasks as Task[])
      expect(graph[1]).toEqual([])
      expect(graph[2]).toEqual([1])
      expect(graph[3]).toEqual([1, 2])
    })

    test('handles empty task list', () => {
      expect(buildGraph([])).toEqual({})
    })
  })

  describe('validateNoCycles', () => {
    test('passes for valid DAG', () => {
      const graph = { 1: [], 2: [1], 3: [1, 2] }
      expect(validateNoCycles(graph)).toEqual({ valid: true })
    })

    test('detects simple cycle', () => {
      const graph = { 1: [2], 2: [1] }
      const result = validateNoCycles(graph)
      expect(result.valid).toBe(false)
      expect(result.cycle).toBeDefined()
    })

    test('detects indirect cycle', () => {
      const graph = { 1: [3], 2: [1], 3: [2] }
      const result = validateNoCycles(graph)
      expect(result.valid).toBe(false)
    })

    test('passes for disconnected graph', () => {
      const graph = { 1: [], 2: [], 3: [] }
      expect(validateNoCycles(graph)).toEqual({ valid: true })
    })
  })

  describe('getReadyTaskIds', () => {
    test('returns unblocked backlog tasks', () => {
      const graph = { 1: [], 2: [1], 3: [] }
      const statuses = new Map<number, string>([
        [1, 'backlog'],
        [2, 'backlog'],
        [3, 'backlog']
      ])
      expect(getReadyTaskIds(graph, statuses).sort()).toEqual([1, 3])
    })

    test('unblocks when dependency is done', () => {
      const graph = { 1: [], 2: [1], 3: [] }
      const statuses = new Map<number, string>([
        [1, 'done'],
        [2, 'backlog'],
        [3, 'done']
      ])
      expect(getReadyTaskIds(graph, statuses)).toEqual([2])
    })

    test('does not return non-backlog tasks', () => {
      const graph = { 1: [], 2: [1] }
      const statuses = new Map<number, string>([
        [1, 'implementing'],
        [2, 'backlog']
      ])
      expect(getReadyTaskIds(graph, statuses)).toEqual([])
    })
  })

  describe('getDependencyChain', () => {
    test('returns topological order of ancestors', () => {
      const graph = { 1: [], 2: [1], 3: [2] }
      expect(getDependencyChain(graph, 3)).toEqual([1, 2])
    })

    test('returns empty for task with no deps', () => {
      const graph = { 1: [] }
      expect(getDependencyChain(graph, 1)).toEqual([])
    })

    test('handles diamond dependency', () => {
      const graph = { 1: [], 2: [1], 3: [1], 4: [2, 3] }
      const chain = getDependencyChain(graph, 4)
      expect(chain).toContain(1)
      expect(chain).toContain(2)
      expect(chain).toContain(3)
      expect(chain.length).toBe(3) // no duplicates
    })
  })

  describe('isTaskBlocked', () => {
    test('identifies blocking tasks', () => {
      const graph = { 1: [], 2: [1] }
      const statuses = new Map<number, string>([
        [1, 'implementing'],
        [2, 'backlog']
      ])
      expect(isTaskBlocked(graph, 2, statuses)).toEqual({
        blocked: true,
        blockedBy: [1]
      })
    })

    test('returns not blocked when deps are done', () => {
      const graph = { 1: [], 2: [1] }
      const statuses = new Map<number, string>([
        [1, 'done'],
        [2, 'backlog']
      ])
      expect(isTaskBlocked(graph, 2, statuses)).toEqual({
        blocked: false,
        blockedBy: []
      })
    })
  })
})
