import { usePipelineStore } from '../../stores/pipelineStore'
import { Modal } from './Modal'

const toolIcons: Record<string, string> = {
  Bash: '>_',
  Write: 'W',
  Edit: 'E',
  Read: 'R',
  Glob: 'G',
  Grep: 'S'
}

export function ApprovalDialog() {
  const approvalRequest = usePipelineStore((s) => s.approvalRequest)
  const resolveApproval = usePipelineStore((s) => s.resolveApproval)

  if (!approvalRequest) return null

  const { requestId, toolName, toolInput } = approvalRequest
  const icon = toolIcons[toolName] ?? toolName.charAt(0).toUpperCase()

  const handleAllow = () => {
    resolveApproval(requestId, true)
  }

  const handleDeny = () => {
    resolveApproval(requestId, false)
  }

  return (
    <Modal onClose={handleDeny}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-violet/20 text-accent-violet flex items-center justify-center font-mono font-bold text-sm shrink-0">
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Tool Approval</h2>
            <p className="text-sm text-text-secondary">
              <span className="font-mono text-accent-violet">{toolName}</span> wants to execute
            </p>
          </div>
        </div>

        {/* Tool input */}
        <div className="bg-bg rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Input</span>
          </div>
          <pre className="p-3 text-sm font-mono text-text-secondary overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap break-words">
            {JSON.stringify(toolInput, null, 2)}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={handleDeny}
            className="px-4 py-2 border border-accent-magenta text-accent-magenta rounded-lg text-sm font-medium hover:bg-accent-magenta/10 transition-colors"
          >
            Deny
          </button>
          <button
            onClick={handleAllow}
            className="px-4 py-2 bg-accent-green text-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Allow
          </button>
        </div>
      </div>
    </Modal>
  )
}
