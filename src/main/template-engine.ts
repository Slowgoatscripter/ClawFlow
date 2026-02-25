import fs from 'fs'
import path from 'path'
import type { Task, Handoff } from '../shared/types'
import type { PipelineStage } from '../shared/types'
import { STAGE_CONFIGS } from '../shared/constants'

const TEMPLATES_DIR = path.join(__dirname, '../../src/templates')

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

export function fillTemplate(template: string, task: Task): string {
  const replacements: Record<string, string> = {
    '{{title}}': task.title,
    '{{description}}': task.description,
    '{{tier}}': task.tier,
    '{{priority}}': task.priority,
    '{{timestamp}}': new Date().toISOString(),
    '{{brainstorm_output}}': task.brainstormOutput ?? 'N/A',
    '{{design_review}}': task.designReview ? JSON.stringify(task.designReview, null, 2) : 'N/A',
    '{{plan}}': task.plan ? JSON.stringify(task.plan, null, 2) : 'N/A',
    '{{implementation_notes}}': task.implementationNotes ? JSON.stringify(task.implementationNotes, null, 2) : 'N/A',
    '{{review_comments}}': task.reviewComments ? JSON.stringify(task.reviewComments, null, 2) : 'N/A',
    '{{review_score}}': task.reviewScore?.toString() ?? 'N/A',
    '{{test_results}}': task.testResults ? JSON.stringify(task.testResults, null, 2) : 'N/A',
    '{{verify_result}}': task.verifyResult ?? 'N/A',
    '{{previous_handoff}}': formatPreviousHandoff(task.handoffs),
    '{{handoff_chain}}': formatHandoffChain(task.handoffs)
  }

  let filled = template
  for (const [placeholder, value] of Object.entries(replacements)) {
    filled = filled.replaceAll(placeholder, value)
  }
  return filled
}

export function constructPrompt(stage: PipelineStage, task: Task): string {
  const template = loadTemplate(stage)
  return fillTemplate(template, task)
}

export function parseHandoff(output: string): Partial<Handoff> | null {
  const handoffMatch = output.match(/### HANDOFF\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/)
  if (!handoffMatch) return null

  const block = handoffMatch[1]

  const extract = (label: string): string => {
    const match = block.match(new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*(.+)`, 'i'))
    return match ? match[1].trim() : ''
  }

  return {
    status: extract('Status') as Handoff['status'] || 'completed',
    summary: extract('Summary'),
    keyDecisions: extract('Key Decisions'),
    openQuestions: extract('Open Questions'),
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
