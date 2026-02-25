# Skill Injection for Pipeline Agents — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make skills available to pipeline agents by loading SKILL.md content at prompt construction time and injecting it into the SDK session prompt.

**Architecture:** Add a `loadSkillContent(skillName)` function to `template-engine.ts` that resolves skill names to their SKILL.md file paths across two locations (superpowers plugin cache, user skills directory). `constructPrompt()` appends the skill content after the template + handoff block. Templates no longer need to say "INVOKE the skill" — the skill instructions are already in the prompt.

**Tech Stack:** Node.js fs, path. No new dependencies.

---

### Task 1: Add `loadSkillContent()` to template-engine.ts

**Files:**
- Modify: `src/main/template-engine.ts`

**Step 1: Add the skill resolution function**

Add `loadSkillContent(skillName: string): string` after the imports. It checks three locations in order:

1. `~/.claude/plugins/cache/superpowers-dev/superpowers/*/skills/<name>/SKILL.md` (glob for latest version)
2. `~/.claude/skills/<name>/SKILL.md` (user directory-based)
3. `~/.claude/skills/<name>.md` (user flat file)

Returns the file content, or an empty string if not found (graceful fallback — pipeline shouldn't break if a skill file is missing).

```typescript
import { homedir } from 'os'

function loadSkillContent(skillName: string): string {
  const home = homedir()

  // 1. Superpowers plugin cache — find latest version
  const pluginBase = path.join(home, '.claude', 'plugins', 'cache', 'superpowers-dev', 'superpowers')
  if (fs.existsSync(pluginBase)) {
    const versions = fs.readdirSync(pluginBase)
      .filter(v => /^\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const version of versions) {
      const skillPath = path.join(pluginBase, version, 'skills', skillName, 'SKILL.md')
      if (fs.existsSync(skillPath)) {
        return fs.readFileSync(skillPath, 'utf-8')
      }
    }
  }

  // 2. User skills — directory form
  const userSkillDir = path.join(home, '.claude', 'skills', skillName, 'SKILL.md')
  if (fs.existsSync(userSkillDir)) {
    return fs.readFileSync(userSkillDir, 'utf-8')
  }

  // 3. User skills — flat file form
  const userSkillFlat = path.join(home, '.claude', 'skills', `${skillName}.md`)
  if (fs.existsSync(userSkillFlat)) {
    return fs.readFileSync(userSkillFlat, 'utf-8')
  }

  return ''
}
```

**Step 2: Verify the function loads correctly**

Run: `node -e "const fs=require('fs'); const path=require('path'); const home=require('os').homedir(); const p=path.join(home,'.claude','plugins','cache','superpowers-dev','superpowers'); console.log(fs.readdirSync(p).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})))"`

Expected: Lists version directories, e.g. `['4.3.0', '4.0.0']`

---

### Task 2: Wire skill content into `constructPrompt()`

**Files:**
- Modify: `src/main/template-engine.ts`

**Step 1: Update `constructPrompt` to append skill content**

```typescript
export function constructPrompt(stage: PipelineStage, task: Task): string {
  const template = loadTemplate(stage)
  const config = STAGE_CONFIGS[stage]
  const skillContent = loadSkillContent(config.skill)

  let prompt = fillTemplate(template, task)

  if (skillContent) {
    prompt += `\n\n---\n\n## Skill Instructions: ${config.skill}\n\nFollow these instructions for this stage:\n\n${skillContent}`
  }

  return prompt
}
```

**Step 2: Commit**

```bash
git add src/main/template-engine.ts
git commit -m "feat: inject skill content into pipeline agent prompts"
```

---

### Task 3: Update templates to remove stale "INVOKE the skill" instructions

**Files:**
- Modify: `src/templates/brainstorm-agent.md`
- Modify: All other templates that reference skill invocation

**Step 1: Update brainstorm-agent.md**

Replace the "Skill Requirement" section:

```markdown
## Skill Requirement

INVOKE the `brainstorming` skill. Follow its process exactly.
```

With:

```markdown
## Skill Instructions

The skill instructions for this stage are appended below. Follow them exactly.
```

**Step 2: Update remaining templates similarly**

Check each template in `src/templates/` for "INVOKE" or "skill" references and update them to reference the appended instructions instead.

**Step 3: Commit**

```bash
git add src/templates/
git commit -m "refactor: update templates to reference injected skill content"
```

---

### Task 4: Build and verify

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Build**

Run: `npm run build`
Expected: Clean build

**Step 3: Manual verification**

Start the app, create an L2 task, run the brainstorm stage. Verify:
- Live output appears (no "skill isn't registered" message)
- The agent follows the brainstorming skill process
- Handoff block is produced correctly

**Step 4: Commit if any fixes were needed**
