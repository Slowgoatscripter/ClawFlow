import { useEffect } from 'react'
import { TopBar } from './TopBar'
import { MetricsRow } from './MetricsRow'
import { KanbanBoard } from '../KanbanBoard/KanbanBoard'
import { ActivityFeed } from '../ActivityFeed/ActivityFeed'
import { useProjectStore } from '../../stores/projectStore'
import { useTaskStore } from '../../stores/taskStore'
import { usePipelineStore } from '../../stores/pipelineStore'

export function Dashboard() {
  useEffect(() => {
    const project = useProjectStore.getState().currentProject
    if (!project) return

    let timer: ReturnType<typeof setInterval>

    const startTimer = (isStreaming: boolean) => {
      clearInterval(timer)
      const interval = isStreaming ? 2000 : 5000
      timer = setInterval(async () => {
        await useTaskStore.getState().loadTasks(project.dbPath)
        const stats = await window.api.tasks.stats(project.dbPath)
        useProjectStore.setState({ stats })
      }, interval)
    }

    // Start initial timer
    let lastStreaming = usePipelineStore.getState().streaming
    startTimer(lastStreaming)

    // Re-subscribe only when the streaming boolean actually changes
    // (not on every store update, which would reset the timer on every stream event)
    const unsubscribe = usePipelineStore.subscribe((state) => {
      if (state.streaming !== lastStreaming) {
        lastStreaming = state.streaming
        startTimer(state.streaming)
      }
    })

    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [])

  return (
    <div className="h-full bg-bg flex flex-col">
      <TopBar />
      <MetricsRow />
      <div className="flex flex-1 min-h-0">
        <KanbanBoard />
        <ActivityFeed />
      </div>
    </div>
  )
}
