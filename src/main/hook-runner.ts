import { execFile } from 'child_process'
import { ValidationHook, HookResult } from '../shared/hook-types'
import { getProjectSetting, getGlobalSetting } from './db'

export async function runHook(hook: ValidationHook, projectPath: string, worktreePath?: string): Promise<HookResult> {
  const cwd = (hook.cwd ?? '{{project_path}}').replace('{{project_path}}', worktreePath ?? projectPath)
  const timeout = hook.timeout ?? 30000
  const start = Date.now()

  return new Promise<HookResult>((resolve) => {
    const args = hook.args ?? []
    execFile(hook.command, args, { cwd, timeout }, (error, stdout, stderr) => {
      resolve({
        name: hook.name,
        success: !error,
        output: (stdout + '\n' + stderr).trim(),
        duration: Date.now() - start
      })
    })
  })
}

export async function runHooks(hooks: ValidationHook[], projectPath: string, worktreePath?: string): Promise<{
  allPassed: boolean
  results: HookResult[]
  failedRequired: HookResult[]
}> {
  const results: HookResult[] = []
  const failedRequired: HookResult[] = []

  for (const hook of hooks) {
    const result = await runHook(hook, projectPath, worktreePath)
    results.push(result)
    if (!result.success && hook.required) {
      failedRequired.push(result)
    }
  }

  return { allPassed: failedRequired.length === 0, results, failedRequired }
}

export function getHooksForStage(dbPath: string, timing: 'pre' | 'post', stage: string): ValidationHook[] {
  const key = `pipeline.hooks.${timing}.${stage}`

  const projectHooks = getProjectSetting(dbPath, key)
  if (projectHooks) {
    try { return JSON.parse(projectHooks) } catch { /* fall through */ }
  }

  const globalHooks = getGlobalSetting(key)
  if (globalHooks) {
    try { return JSON.parse(globalHooks) } catch { /* fall through */ }
  }

  return []
}
