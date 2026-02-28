import { useState } from 'react'
import { usePipelineStore } from '../../stores/pipelineStore'
import { Modal } from './Modal'

export default function UserQuestionDialog() {
  const userQuestion = usePipelineStore((s) => s.userQuestion)
  const resolveUserQuestion = usePipelineStore((s) => s.resolveUserQuestion)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})

  if (!userQuestion) return null

  const { requestId, taskId, questions } = userQuestion

  const allAnswered = questions.every((q) => {
    const answer = answers[q.question]
    if (!answer) return false
    if (answer === '__other__') return !!otherTexts[q.question]?.trim()
    return true
  })

  const handleSelect = (question: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [question]: value }))
  }

  const handleOtherText = (question: string, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [question]: text }))
  }

  const handleSubmit = () => {
    const finalAnswers: Record<string, string> = {}
    for (const q of questions) {
      const answer = answers[q.question]
      if (answer === '__other__') {
        finalAnswers[q.question] = otherTexts[q.question] || ''
      } else if (answer) {
        finalAnswers[q.question] = answer
      }
    }
    resolveUserQuestion(requestId, finalAnswers)
    setAnswers({})
    setOtherTexts({})
  }

  const handleSkip = () => {
    resolveUserQuestion(requestId, {})
    setAnswers({})
    setOtherTexts({})
  }

  return (
    <Modal onClose={handleSkip}>
      <div className="space-y-5 max-h-[70vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-amber/20 text-accent-amber flex items-center justify-center font-mono font-bold text-lg shrink-0">
            ?
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Agent Question</h2>
            <p className="text-sm text-text-secondary">
              Task <span className="font-mono text-accent-cyan">#{taskId}</span> is asking for input
            </p>
          </div>
        </div>

        {/* Questions */}
        {questions.map((q, qi) => {
          const selected = answers[q.question] || ''
          return (
            <div key={qi} className="space-y-3">
              {/* Header chip */}
              {q.header && (
                <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-accent-violet/15 text-accent-violet">
                  {q.header}
                </span>
              )}

              {/* Question text */}
              <p className="text-sm text-text-primary font-medium">{q.question}</p>

              {/* Options */}
              <div className="space-y-2">
                {q.options.map((opt, oi) => {
                  const isSelected = selected === opt.label
                  return (
                    <label
                      key={oi}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-accent-cyan/60 bg-accent-cyan/5'
                          : 'border-border hover:border-border-bright'
                      }`}
                    >
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={`question-${qi}`}
                        checked={isSelected}
                        onChange={() => handleSelect(q.question, opt.label)}
                        className="mt-0.5 accent-[#00e5ff]"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-text-primary">{opt.label}</span>
                        {opt.description && (
                          <p className="text-xs text-text-secondary mt-0.5">{opt.description}</p>
                        )}
                      </div>
                    </label>
                  )
                })}

                {/* Other option */}
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selected === '__other__'
                      ? 'border-accent-cyan/60 bg-accent-cyan/5'
                      : 'border-border hover:border-border-bright'
                  }`}
                >
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={`question-${qi}`}
                    checked={selected === '__other__'}
                    onChange={() => handleSelect(q.question, '__other__')}
                    className="mt-0.5 accent-[#00e5ff]"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-text-primary">Other</span>
                    {selected === '__other__' && (
                      <input
                        type="text"
                        value={otherTexts[q.question] || ''}
                        onChange={(e) => handleOtherText(q.question, e.target.value)}
                        placeholder="Enter your answer..."
                        autoFocus
                        className="mt-2 w-full px-3 py-1.5 text-sm rounded border border-border bg-bg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/60"
                      />
                    )}
                  </div>
                </label>
              </div>

              {/* Separator between questions */}
              {qi < questions.length - 1 && <div className="border-t border-border" />}
            </div>
          )
        })}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
          <button
            onClick={handleSkip}
            className="px-4 py-2 border border-border text-text-secondary rounded-lg text-sm font-medium hover:bg-elevated transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="px-4 py-2 bg-accent-cyan text-bg rounded-lg text-sm font-medium transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            Submit
          </button>
        </div>
      </div>
    </Modal>
  )
}
