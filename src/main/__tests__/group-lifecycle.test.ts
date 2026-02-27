import { describe, test, expect, beforeEach } from 'vitest'
import {
  createTask,
  createTaskGroup,
  createWorkshopSession,
  getTaskGroup,
  getTasksByGroup,
  updateTaskGroup,
  deleteTaskGroup,
  listTaskGroups,
  getProjectDb
} from '../db'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync } from 'fs'

describe('Task Group Lifecycle', () => {
  let dbPath: string
  let sessionId: string

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'clawflow-test-'))
    dbPath = join(tmpDir, 'test.db')
    // Initialize the project db
    getProjectDb(dbPath)
    // Create a workshop session to satisfy the FK constraint on task_groups.session_id
    const session = createWorkshopSession(dbPath, 'test-project', 'Test Session')
    sessionId = session.id
  })

  test('creates a group and links tasks', () => {
    const group = createTaskGroup(dbPath, {
      title: 'Test Feature',
      sessionId: sessionId as unknown as number,
      sharedContext: 'Build a test feature with two components'
    })

    expect(group.id).toBeDefined()
    expect(group.status).toBe('planning')
    expect(group.title).toBe('Test Feature')

    const task1 = createTask(dbPath, {
      title: 'Task A',
      description: 'First part',
      tier: 'L2',
      priority: 'medium',
      groupId: group.id,
      workOrder: {
        objective: 'Build component A',
        files: [{ path: 'src/a.ts', action: 'create' as const, description: 'Create A' }],
        patterns: [],
        integration: ['Task B imports from this'],
        constraints: [],
        tests: ['Unit test for A']
      },
      assignedSkill: 'test-driven-development'
    })

    const task2 = createTask(dbPath, {
      title: 'Task B',
      description: 'Second part',
      tier: 'L2',
      priority: 'medium',
      groupId: group.id
    })

    expect(task1.groupId).toBe(group.id)
    expect(task1.workOrder?.objective).toBe('Build component A')
    expect(task1.assignedSkill).toBe('test-driven-development')
    expect(task2.groupId).toBe(group.id)

    const groupTasks = getTasksByGroup(dbPath, group.id)
    expect(groupTasks).toHaveLength(2)
  })

  test('group status lifecycle', () => {
    const group = createTaskGroup(dbPath, {
      title: 'Lifecycle Test',
      sessionId: sessionId as unknown as number,
      sharedContext: ''
    })

    expect(group.status).toBe('planning')

    updateTaskGroup(dbPath, group.id, { status: 'queued' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('queued')

    updateTaskGroup(dbPath, group.id, { status: 'running' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('running')

    updateTaskGroup(dbPath, group.id, { status: 'paused' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('paused')

    updateTaskGroup(dbPath, group.id, { status: 'completed' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('completed')
  })

  test('deleting group unlinks tasks', () => {
    const group = createTaskGroup(dbPath, {
      title: 'Delete Test',
      sessionId: sessionId as unknown as number,
      sharedContext: ''
    })

    createTask(dbPath, {
      title: 'Linked Task',
      description: 'Should be unlinked',
      tier: 'L2',
      priority: 'medium',
      groupId: group.id
    })

    deleteTaskGroup(dbPath, group.id)

    expect(getTaskGroup(dbPath, group.id)).toBeNull()
    const tasks = getTasksByGroup(dbPath, group.id)
    expect(tasks).toHaveLength(0)
  })

  test('listTaskGroups returns all groups', () => {
    createTaskGroup(dbPath, { title: 'Group 1', sessionId: sessionId as unknown as number, sharedContext: 'ctx1' })
    createTaskGroup(dbPath, { title: 'Group 2', sessionId: sessionId as unknown as number, sharedContext: 'ctx2' })

    const groups = listTaskGroups(dbPath)
    expect(groups).toHaveLength(2)
    expect(groups[0].title).toBe('Group 1')
    expect(groups[1].title).toBe('Group 2')
  })

  test('work order is serialized and deserialized correctly', () => {
    const group = createTaskGroup(dbPath, {
      title: 'Serialization Test',
      sessionId: sessionId as unknown as number,
      sharedContext: ''
    })

    const workOrder = {
      objective: 'Test serialization',
      files: [
        { path: 'src/test.ts', action: 'create' as const, description: 'Test file' },
        { path: 'src/existing.ts', action: 'modify' as const, description: 'Modify existing' }
      ],
      patterns: ['Follow TDD', 'Use existing error patterns'],
      integration: ['Connects to module X'],
      constraints: ['Do not modify shared types'],
      tests: ['Unit tests for all functions']
    }

    const task = createTask(dbPath, {
      title: 'Serialized Task',
      description: 'Tests JSON round-trip',
      tier: 'L2',
      priority: 'medium',
      groupId: group.id,
      workOrder,
      assignedSkill: 'frontend-design'
    })

    expect(task.workOrder).toEqual(workOrder)
    expect(task.assignedSkill).toBe('frontend-design')
    expect(task.workOrder!.files).toHaveLength(2)
    expect(task.workOrder!.patterns).toHaveLength(2)
  })
})
