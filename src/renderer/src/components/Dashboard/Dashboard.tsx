import { useEffect } from 'react'
import { TopBar } from './TopBar'
import { MetricsRow } from './MetricsRow'
import { KanbanBoard } from '../KanbanBoard/KanbanBoard'
import { ActivityFeed } from '../ActivityFeed/ActivityFeed'
import { useProjectStore } from '../../stores/projectStore'
import { useTaskStore } from '../../stores/taskStore'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useLayoutStore } from '../../stores/layoutStore'

export function Dashboard() {
  const activityFeedOpen = useLayoutStore((s) => s.activityFeedOpen)
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
    startTimer(usePipelineStore.getState().streaming)

    // Re-subscribe when streaming state changes
    const unsubscribe = usePipelineStore.subscribe((state) => {
      startTimer(state.streaming)
    })

    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [])

  return (
    <div className="h-screen bg-bg flex flex-col">
      <TopBar />
      <MetricsRow />
      <div className="flex flex-1 min-h-0">
        <KanbanBoard />
        {activityFeedOpen && <ActivityFeed />}
      </div>
    </div>
  )
}
