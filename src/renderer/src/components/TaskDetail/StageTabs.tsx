import { useState } from 'react'
import type { Task, PipelineStage } from '../../../../shared/types'

interface StageData {
  stage: PipelineStage
  label: string
  content: string | null
}

function getStageData(task: Task): StageData[] {
  const stages: StageData[] = [
    { stage: 'brainstorm', label: 'Brainstorm', content: task.brainstormOutput ?? null },
    {
      stage: 'design_review',
      label: 'Design Review',
      content: task.designReview ? JSON.stringify(task.designReview, null, 2) : null
    },
    {
      stage: 'plan',
      label: 'Plan',
      content: task.plan ? JSON.stringify(task.plan, null, 2) : null
    },
    {
      stage: 'implement',
      label: 'Implement',
      content: task.implementationNotes ? JSON.stringify(task.implementationNotes, null, 2) : null
    },
    {
      stage: 'code_review',
      label: 'Code Review',
      content: task.reviewComments ? JSON.stringify(task.reviewComments, null, 2) : null
    },
    {
      stage: 'verify',
      label: 'Verify',
      content: task.verifyResult ?? null
    }
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
                ? 'text-accent-teal border-b-2 border-accent-teal'
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
