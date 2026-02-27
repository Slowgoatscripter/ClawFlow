import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import type { Task, Handoff } from '../shared/types'
import type { PipelineStage } from '../shared/types'
import { STAGE_CONFIGS } from '../shared/constants'

const TEMPLATES_DIR = path.join(__dirname, '../../src/templates')

function extractOutput(field: unknown): string {
  if (!field) return 'N/A'
  if (typeof field === 'string') return field
  if (typeof field === 'object' && field !== null && 'output' in field) {
    return (field as { output: string }).output
  }
  return JSON.stringify(field)
}

export function loadTemplate(stage: PipelineStage): string {
  const config = STAGE_CONFIGS[stage]
  const templatePath = path.join(TEMPLATES_DIR, config.template)

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`)
  }

  let template = fs.readFileSync(templatePath, 'utf-8')

  const handoffPath = path.join(TEMPLATES_DIR, '_handoff.md')
  if (fs.existsSync(handoffPath)) {
    template += '\n\n' + fs.readFileSync(handoffPath, 'utf-8')
  }

  return template
}

export function fillTemplate(template: string, task: Task, projectPath?: string): string {
  const replacements: Record<string, string> = {
    '{{title}}': task.title,
    '{{description}}': task.description,
    '{{tier}}': task.tier,
    '{{priority}}': task.priority,
    '{{timestamp}}': new Date().toISOString(),
    '{{project_path}}': projectPath ?? process.cwd(),
    '{{platform}}': process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
    '{{brainstorm_output}}': task.brainstormOutput ?? 'N/A',
    '{{brainstorm_context}}': (() => {
      if (task.tier === 'L3' && task.designReview) {
        return 'Brainstorm output was reviewed in the design_review stage. See previous handoff for decisions and requirements.'
      }
      return task.brainstormOutput ?? 'N/A'
    })(),
    '{{design_review}}': extractOutput(task.designReview),
    '{{plan}}': extractOutput(task.plan),
    '{{implementation_notes}}': extractOutput(task.implementationNotes),
    '{{review_comments}}': extractOutput(task.reviewComments),
    '{{review_score}}': task.reviewScore?.toString() ?? 'N/A',
    '{{test_results}}': extractOutput(task.testResults),
    '{{verify_result}}': task.verifyResult ?? 'N/A',
    '{{plan_summary}}': (() => {
      const handoffs = typeof task.handoffs === 'string' ? JSON.parse(task.handoffs) : task.handoffs
      const planHandoff = handoffs?.find((h: any) => h.stage === 'plan')
      if (planHandoff) {
        return `**Plan Summary:** ${planHandoff.summary}\n**Key Decisions:** ${planHandoff.keyDecisions ?? 'N/A'}\n**Files to Modify:** ${planHandoff.filesModified ?? 'N/A'}`
      }
      return extractOutput(task.plan)
    })(),
    '{{implementation_summary}}': (() => {
      const handoffs = typeof task.handoffs === 'string' ? JSON.parse(task.handoffs) : task.handoffs
      const implHandoff = handoffs?.find((h: any) => h.stage === 'implement')
      if (implHandoff) {
        return `**Implementation Summary:** ${implHandoff.summary}\n**Key Decisions:** ${implHandoff.keyDecisions ?? 'N/A'}\n**Files Modified:** ${implHandoff.filesModified ?? 'N/A'}`
      }
      return extractOutput(task.implementationNotes)
    })(),
    '{{previous_handoff}}': formatPreviousHandoff(task.handoffs),
    '{{handoff_chain}}': formatHandoffChain(task.handoffs)
  }

  let filled = template
  for (const [placeholder, value] of Object.entries(replacements)) {
    filled = filled.replaceAll(placeholder, value)
  }
  return filled
}

export function loadSkillContent(skillName: string): string {
  try {
    const home = homedir()

    // 1. Superpowers plugin cache — find latest version directory
    const superpowersCacheBase = path.join(
      home,
      '.claude',
      'plugins',
      'cache',
      'superpowers-dev',
      'superpowers'
    )
    if (fs.existsSync(superpowersCacheBase)) {
      try {
        const versionDirs = fs
          .readdirSync(superpowersCacheBase)
          .filter((d) => fs.statSync(path.join(superpowersCacheBase, d)).isDirectory())
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

        for (const ver of versionDirs) {
          const skillPath = path.join(superpowersCacheBase, ver, 'skills', skillName, 'SKILL.md')
          if (fs.existsSync(skillPath)) {
            return fs.readFileSync(skillPath, 'utf-8')
          }
        }
      } catch {
        // Ignore errors reading superpowers cache
      }
    }

    // 2. User skills directory form
    const userSkillDir = path.join(home, '.claude', 'skills', skillName, 'SKILL.md')
    if (fs.existsSync(userSkillDir)) {
      return fs.readFileSync(userSkillDir, 'utf-8')
    }

    // 3. User skills flat form
    const userSkillFlat = path.join(home, '.claude', 'skills', `${skillName}.md`)
    if (fs.existsSync(userSkillFlat)) {
      return fs.readFileSync(userSkillFlat, 'utf-8')
    }

    return ''
  } catch {
    return ''
  }
}

export function constructPrompt(stage: PipelineStage, task: Task, projectPath?: string): string {
  const template = loadTemplate(stage)
  const config = STAGE_CONFIGS[stage]
  const skillContent = loadSkillContent(config.skill)

  let prompt = fillTemplate(template, task, projectPath)

  if (skillContent) {
    prompt += `\n\n---\n\n## Skill Instructions: ${config.skill}\n\nFollow these instructions for this stage:\n\n${skillContent}`
  }

  return prompt
}

export function parseHandoff(output: string): Partial<Handoff> | null {
  const handoffMatch = output.match(/### HANDOFF\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/)
  if (!handoffMatch) return null

  const block = handoffMatch[1]

  const extract = (label: string): string => {
    const match = block.match(new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*(.+)`, 'i'))
    return match ? match[1].trim() : ''
  }

  // Normalize openQuestions: treat "none", "none — ...", "n/a", etc. as empty
  const rawQuestions = extract('Open Questions')
  const openQuestions = /^none\b|^n\/?a\b/i.test(rawQuestions) ? '' : rawQuestions

  return {
    status: extract('Status') as Handoff['status'] || 'completed',
    summary: extract('Summary'),
    keyDecisions: extract('Key Decisions'),
    openQuestions,
    filesModified: extract('Files Modified'),
    nextStageNeeds: extract('Next Stage Needs'),
    warnings: extract('Warnings')
  }
}

function formatPreviousHandoff(handoffs: Handoff[]): string {
  if (handoffs.length === 0) return 'No previous stages.'
  const last = handoffs[handoffs.length - 1]
  return [
    `> **${last.agent}** \`${last.model}\` · ${last.timestamp}`,
    `- **Status**: ${last.status}`,
    `- **Summary**: ${last.summary}`,
    `- **Key Decisions**: ${last.keyDecisions}`,
    `- **Open Questions**: ${last.openQuestions}`,
    `- **Files Modified**: ${last.filesModified}`,
    `- **Next Stage Needs**: ${last.nextStageNeeds}`,
    `- **Warnings**: ${last.warnings}`
  ].join('\n')
}

function formatHandoffChain(handoffs: Handoff[]): string {
  if (handoffs.length === 0) return 'No handoff history.'
  return handoffs.map((h, i) =>
    `**Stage ${i + 1}: ${h.stage}** (${h.agent})\n${h.summary}`
  ).join('\n\n')
}

export function constructWorkshopPrompt(params: {
  projectName: string
  sessionSummaries: string
  artifactList: string
  pipelineState: string
}): string {
  const templatePath = path.join(TEMPLATES_DIR, 'workshop-agent.md')
  let template = fs.readFileSync(templatePath, 'utf-8')

  const replacements: Record<string, string> = {
    '{{project_name}}': params.projectName,
    '{{session_summaries}}': params.sessionSummaries || 'No previous sessions.',
    '{{artifact_list}}': params.artifactList || 'No artifacts yet.',
    '{{pipeline_state}}': params.pipelineState || 'No active pipeline tasks.',
  }

  for (const [placeholder, value] of Object.entries(replacements)) {
    template = template.replaceAll(placeholder, value)
  }

  return template
}
