import { useState } from 'react'
import type { Task, PipelineStage } from '../../../../shared/types'

interface StageData {
  stage: PipelineStage
  label: string
  content: string | null
}

/** Extract readable text from a stage output (may be a string or { output, cost, sessionId } object) */
function extractOutput(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'output' in value) {
    return (value as { output: string }).output ?? null
  }
  return JSON.stringify(value, null, 2)
}

function getStageData(task: Task): StageData[] {
  const stages: StageData[] = [
    { stage: 'brainstorm', label: 'Brainstorm', content: task.brainstormOutput ?? null },
    { stage: 'design_review', label: 'Design Review', content: extractOutput(task.designReview) },
    { stage: 'plan', label: 'Plan', content: extractOutput(task.plan) },
    { stage: 'implement', label: 'Implement', content: extractOutput(task.implementationNotes) },
    { stage: 'code_review', label: 'Code Review', content: extractOutput(task.reviewComments) },
    { stage: 'verify', label: 'Verify', content: task.verifyResult ?? null }
  ]
  return stages
}

export function StageTabs({ task }: { task: Task }) {
  const stages = getStageData(task)
  const populated = stages.filter(s => s.content !== null)
  const [activeTab, setActiveTab] = useState<PipelineStage | null>(
    populated.length > 0 ? populated[0].stage : null
  )

  if (populated.length === 0) {
    return (
      <div className="bg-surface rounded-lg p-6 text-text-muted text-sm text-center">
        No data yet
      </div>
    )
  }

  const activeStage = stages.find(s => s.stage === activeTab)

  return (
    <div className="bg-surface rounded-lg overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border overflow-x-auto">
        {populated.map(s => (
          <button
            key={s.stage}
            onClick={() => setActiveTab(s.stage)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${
              activeTab === s.stage
                ? 'text-accent-cyan border-b-2 border-accent-cyan'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="p-4">
        <pre className="font-mono text-sm bg-elevated p-4 rounded overflow-auto max-h-[400px] text-text-primary">
          <code>{activeStage?.content ?? 'No data yet'}</code>
        </pre>
      </div>
    </div>
  )
}
