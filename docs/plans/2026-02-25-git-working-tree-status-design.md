# Git Working Tree Status Enhancement — ClawFlow

**Date:** 2026-02-25
**Status:** Approved

## Summary

Enhance the Git view to show working tree status (uncommitted/untracked files) per branch, add a Stage All button, show dirty indicators in the branch list, and parse git errors into actionable messages.

## Changes

### 1. New type: FileStatus
```ts
interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
  staged: boolean
}
```

### 2. GitEngine new methods
- `getWorkingTreeStatus(taskId)` — returns FileStatus[] from `git status --porcelain`
- `stageAll(taskId)` — runs `git add .` in the branch's worktree
- Improved error parsing in merge/push for actionable messages

### 3. UI enhancements
- BranchDetail: Working Tree section with file list, warning header, Stage All button
- BranchList: Warning dot on dirty branches
- Error messages parsed from git failures into human-readable guidance
- Auto-refresh status on branch select and after actions

### 4. Files to change
- `src/main/git-engine.ts`
- `src/shared/types.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/src/stores/gitStore.ts`
- `src/renderer/src/components/Git/BranchDetail.tsx`
- `src/renderer/src/components/Git/BranchList.tsx`
