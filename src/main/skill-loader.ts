import path from 'path'
import os from 'os'
import fs from 'fs'
import { getGlobalSetting, getProjectSetting } from './db'
import { STAGE_SKILL_MAP } from '../shared/skill-types'
import type { SkillInfo } from '../shared/skill-types'

const SKILLS_DIR = path.join(os.homedir(), '.clawflow', 'skills')
const DEFAULTS_DIR = path.join(__dirname, '..', 'skills', 'defaults')

// --- Token estimation ---

function estimateTokens(content: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(content.length / 4)
}

// --- Initialization ---

export function ensureSkillsSeeded(): void {
  fs.mkdirSync(SKILLS_DIR, { recursive: true })

  if (!fs.existsSync(DEFAULTS_DIR)) return

  const defaults = fs.readdirSync(DEFAULTS_DIR, { withFileTypes: true })
  for (const entry of defaults) {
    if (!entry.isDirectory()) continue
    const targetDir = path.join(SKILLS_DIR, entry.name)
    if (fs.existsSync(targetDir)) continue

    // Copy the entire default skill directory
    fs.mkdirSync(targetDir, { recursive: true })
    const sourceDir = path.join(DEFAULTS_DIR, entry.name)
    const files = fs.readdirSync(sourceDir)
    for (const file of files) {
      fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file))
    }
  }
}

// --- Skill resolution ---

export function getSkillForStage(stage: string, dbPath?: string): string | null {
  // 1. Project-level override
  if (dbPath) {
    const projectOverride = getProjectSetting(dbPath, `pipeline.skill.${stage}`)
    if (projectOverride) return projectOverride
  }

  // 2. Global-level override
  const globalOverride = getGlobalSetting(`pipeline.skill.${stage}`)
  if (globalOverride) return globalOverride

  // 3. Default mapping
  return STAGE_SKILL_MAP[stage] ?? null
}

// --- Loading ---

export function loadSkillCore(stage: string, dbPath?: string): string {
  const skillName = getSkillForStage(stage, dbPath)
  if (!skillName) return ''

  const corePath = path.join(SKILLS_DIR, skillName, 'core.md')
  try {
    return fs.readFileSync(corePath, 'utf-8')
  } catch {
    return ''
  }
}

export function loadSkillExtended(skillName: string): string {
  const extPath = path.join(SKILLS_DIR, skillName, 'extended.md')
  try {
    return fs.readFileSync(extPath, 'utf-8')
  } catch {
    return ''
  }
}

// --- Listing ---

export function listSkills(): SkillInfo[] {
  if (!fs.existsSync(SKILLS_DIR)) return []

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
  const skills: SkillInfo[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillDir = path.join(SKILLS_DIR, entry.name)
    const corePath = path.join(skillDir, 'core.md')
    const extPath = path.join(skillDir, 'extended.md')

    let coreContent = ''
    let extContent = ''

    try {
      coreContent = fs.readFileSync(corePath, 'utf-8')
    } catch {
      // core.md doesn't exist
    }

    try {
      extContent = fs.readFileSync(extPath, 'utf-8')
    } catch {
      // extended.md doesn't exist
    }

    skills.push({
      name: entry.name,
      hasCore: coreContent.length > 0,
      hasExtended: extContent.length > 0,
      coreTokenEstimate: coreContent ? estimateTokens(coreContent) : 0,
      extendedTokenEstimate: extContent ? estimateTokens(extContent) : 0
    })
  }

  return skills
}

// --- Editing (Workshop only) ---

export function editSkill(skillName: string, tier: 'core' | 'extended', content: string): void {
  const skillDir = path.join(SKILLS_DIR, skillName)
  fs.mkdirSync(skillDir, { recursive: true })

  const fileName = tier === 'core' ? 'core.md' : 'extended.md'
  fs.writeFileSync(path.join(skillDir, fileName), content, 'utf-8')
}

export function viewSkill(
  skillName: string,
  tier?: 'core' | 'extended'
): { core?: string; extended?: string } {
  const skillDir = path.join(SKILLS_DIR, skillName)
  const result: { core?: string; extended?: string } = {}

  if (!tier || tier === 'core') {
    try {
      result.core = fs.readFileSync(path.join(skillDir, 'core.md'), 'utf-8')
    } catch {
      result.core = undefined
    }
  }

  if (!tier || tier === 'extended') {
    try {
      result.extended = fs.readFileSync(path.join(skillDir, 'extended.md'), 'utf-8')
    } catch {
      result.extended = undefined
    }
  }

  return result
}
