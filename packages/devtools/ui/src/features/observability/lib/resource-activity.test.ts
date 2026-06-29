import { describe, expect, it } from 'vitest'
import type { ObservabilityResourceActivity, TaskUpdatedEvent } from '@/types'
import { taskEventsFromResourceActivity } from './resource-activity'

function taskActivity(status: string, progress?: string): ObservabilityResourceActivity {
  return {
    spanId: `span-${status}`,
    runId: 'run-tasks',
    traceId: 'trace-tasks',
    family: 'task',
    primitive: 'task.operation',
    name: 'task.update',
    status: 'ok',
    startedAt: '2026-05-21T10:00:00.000Z',
    endedAt: '2026-05-21T10:00:00.010Z',
    durationMs: 10,
    resourceId: `task-${status}`,
    attributes: { operation: 'update', taskListId: 'list-1', taskId: `task-${status}`, status },
    artifacts: [
      {
        artifactId: `artifact-${status}`,
        runId: 'run-tasks',
        traceId: 'trace-tasks',
        spanId: `span-${status}`,
        kind: 'output',
        createdAt: '2026-05-21T10:00:00.010Z',
        contentType: 'application/json',
        encoding: 'json',
        sizeBytes: 0,
        hash: '',
        uri: '',
        preview: {
          primitive: 'task.operation',
          operation: 'update',
          taskListId: 'list-1',
          taskId: `task-${status}`,
          status,
          progress,
        },
      },
    ],
  }
}

describe('taskEventsFromResourceActivity', () => {
  it('preserves canonical task statuses and progress messages', () => {
    const { taskEvents } = taskEventsFromResourceActivity([
      taskActivity('completed'),
      taskActivity('failed', 'Errored while drafting'),
      taskActivity('skipped'),
      taskActivity('cancelled'),
    ])

    const updates = taskEvents.filter(
      (event): event is TaskUpdatedEvent & { _kind: 'updated' } => event.type === 'task:updated',
    )

    expect(updates.map((event) => event.status)).toEqual(['completed', 'failed', 'skipped', 'cancelled'])
    expect(updates.find((event) => event.status === 'failed')?.progress).toBe('Errored while drafting')
  })
})
