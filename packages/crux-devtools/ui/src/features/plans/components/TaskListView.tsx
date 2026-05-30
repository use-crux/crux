import { fmt } from '@/shared/components/ui-atoms'

interface TaskListViewProps {
  taskListId: string
  planId?: string
  status: string
  tasks: Array<{
    taskId: string
    label: string
    status: string
    progress?: string
    assignee?: { agent?: string; model?: string }
    durationMs?: number
    isNew?: boolean
  }>
  timestamp: number
}

const TASK_STATUS: Record<string, { icon: string; color: string }> = {
  completed: { icon: '✓', color: 'var(--qw-ok)' },
  in_progress: { icon: '⟳', color: 'var(--qw-crux)' },
  pending: { icon: '○', color: 'var(--qw-fg-muted)' },
  failed: { icon: '✕', color: 'var(--qw-danger)' },
  removed: { icon: '⊘', color: 'var(--qw-fg-faint)' },
  skipped: { icon: '⊖', color: 'var(--qw-fg-muted)' },
  cancelled: { icon: '✕', color: 'var(--qw-danger)' },
}

function taskStatus(status: string) {
  return TASK_STATUS[status] ?? TASK_STATUS.pending!
}

const LIST_STATUS_DOT: Record<string, string> = {
  pending: 'var(--qw-fg-muted)',
  in_progress: 'var(--qw-crux)',
  completed: 'var(--qw-ok)',
  failed: 'var(--qw-danger)',
}

export function TaskListView({
  taskListId: _taskListId,
  planId,
  status,
  tasks,
  timestamp,
}: TaskListViewProps) {
  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const totalCount = tasks.length
  const dotColor = LIST_STATUS_DOT[status] ?? 'var(--qw-fg-faint)'
  const isRunning = status === 'in_progress'

  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--qw-border)' }}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${isRunning ? 'animate-running-pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <span
          className="font-mono text-[13px] font-medium tabular-nums"
          style={{ color: 'var(--qw-fg)' }}
        >
          {completedCount}/{totalCount}
        </span>
        <span className="text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {status.replace('_', ' ')}
        </span>
        {planId && (
          <span
            className="max-w-[140px] truncate font-mono text-[10.5px]"
            style={{ color: 'var(--qw-fg-faint)' }}
            title={planId}
          >
            plan:{planId.slice(0, 8)}
          </span>
        )}
        <span
          className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums"
          style={{ color: 'var(--qw-fg-faint)' }}
        >
          {new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      </div>

      <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
        {tasks.map((task) => {
          const ts = taskStatus(task.status)
          const isRemoved = task.status === 'removed'
          return (
            <div
              key={task.taskId}
              className="flex items-start gap-2 px-3 py-1.5"
              style={{ background: 'var(--qw-bg-elev)' }}
            >
              {task.isNew && (
                <span
                  className="shrink-0 text-[10.5px] leading-5"
                  style={{ color: 'var(--qw-crux)' }}
                  title="Dynamically added"
                >
                  +
                </span>
              )}
              <span
                className={`w-4 shrink-0 text-center font-mono text-[12px] leading-5 ${
                  task.status === 'in_progress' ? 'animate-spin-slow' : ''
                }`}
                style={{ color: ts.color }}
              >
                {ts.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-[13px] leading-5"
                  style={{
                    color: isRemoved ? 'var(--qw-fg-faint)' : 'var(--qw-fg)',
                    textDecoration: isRemoved ? 'line-through' : 'none',
                  }}
                >
                  {task.label}
                </div>
                {task.progress && (
                  <div
                    className="mt-0.5 truncate text-[10.5px] leading-tight"
                    style={{ color: 'var(--qw-fg-muted)' }}
                  >
                    {task.progress}
                  </div>
                )}
              </div>
              {task.assignee && (task.assignee.agent || task.assignee.model) && (
                <span
                  className="max-w-[120px] shrink-0 truncate font-mono text-[10.5px]"
                  style={{ color: 'var(--qw-fg-faint)' }}
                  title={[task.assignee.agent, task.assignee.model].filter(Boolean).join(' / ')}
                >
                  {task.assignee.agent ?? task.assignee.model?.replace(/^[^/]+\//, '')}
                </span>
              )}
              {task.durationMs != null && task.durationMs > 0 && (
                <span
                  className="shrink-0 font-mono text-[10.5px] tabular-nums"
                  style={{ color: 'var(--qw-fg-faint)' }}
                >
                  {fmt(task.durationMs, 'ms')}
                </span>
              )}
            </div>
          )
        })}
        {tasks.length === 0 && (
          <div
            className="px-3 py-3 text-center text-[12px]"
            style={{ background: 'var(--qw-bg-elev)', color: 'var(--qw-fg-faint)' }}
          >
            No tasks
          </div>
        )}
      </div>
    </div>
  )
}
