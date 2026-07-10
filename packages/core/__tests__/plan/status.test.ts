/**
 * Tests for the pure-function status machine.
 *
 * These verify O(1) status derivation from counters,
 * replacing the previous O(n) task-scanning approach.
 */

import { describe, it, expect } from 'vitest'
import { emptyCounts, applyCounts, deriveStatus, rebuildCounts, type StatusCounts } from '../../src/plan/status'

// ─────────────────────────────────────────────────────────────────
// emptyCounts
// ─────────────────────────────────────────────────────────────────

describe('emptyCounts', () => {
  it('returns all zeros', () => {
    const counts = emptyCounts()
    expect(counts).toEqual({
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    })
  })
})

// ─────────────────────────────────────────────────────────────────
// deriveStatus — pure O(1) derivation from counters
// ─────────────────────────────────────────────────────────────────

describe('deriveStatus', () => {
  it('returns completed when all counts are zero (no active tasks)', () => {
    expect(deriveStatus(emptyCounts())).toBe('completed')
  })

  it('returns completed when all tasks are completed', () => {
    const counts: StatusCounts = { ...emptyCounts(), completed: 5 }
    expect(deriveStatus(counts)).toBe('completed')
  })

  it('returns completed when all tasks are completed or skipped', () => {
    const counts: StatusCounts = { ...emptyCounts(), completed: 3, skipped: 2 }
    expect(deriveStatus(counts)).toBe('completed')
  })

  it('returns failed when any task failed and none in progress', () => {
    const counts: StatusCounts = { ...emptyCounts(), completed: 2, failed: 1 }
    expect(deriveStatus(counts)).toBe('failed')
  })

  it('returns in_progress when tasks are failed but some still in progress', () => {
    const counts: StatusCounts = {
      ...emptyCounts(),
      in_progress: 1,
      failed: 1,
    }
    expect(deriveStatus(counts)).toBe('in_progress')
  })

  it('returns pending when all active tasks are pending', () => {
    const counts: StatusCounts = { ...emptyCounts(), pending: 3 }
    expect(deriveStatus(counts)).toBe('pending')
  })

  it('returns in_progress for mixed active statuses', () => {
    const counts: StatusCounts = {
      pending: 2,
      in_progress: 1,
      completed: 3,
      failed: 0,
      skipped: 1,
      cancelled: 0,
    }
    expect(deriveStatus(counts)).toBe('in_progress')
  })

  it('returns in_progress when only cancelled tasks remain with pending', () => {
    const counts: StatusCounts = { ...emptyCounts(), pending: 1, cancelled: 2 }
    expect(deriveStatus(counts)).toBe('in_progress')
  })

  it('returns cancelled when all active tasks are cancelled', () => {
    const counts: StatusCounts = { ...emptyCounts(), cancelled: 2 }
    expect(deriveStatus(counts)).toBe('cancelled')
  })

  it('returns cancelled when terminal active tasks include cancelled and no failures', () => {
    const counts: StatusCounts = {
      ...emptyCounts(),
      completed: 1,
      skipped: 1,
      cancelled: 1,
    }
    expect(deriveStatus(counts)).toBe('cancelled')
  })
})

// ─────────────────────────────────────────────────────────────────
// applyCounts — incremental counter updates
// ─────────────────────────────────────────────────────────────────

describe('applyCounts', () => {
  it('increments pending on add', () => {
    const result = applyCounts(emptyCounts(), { type: 'add' })
    expect(result.pending).toBe(1)
  })

  it('returns a new object (no mutation)', () => {
    const original = emptyCounts()
    const result = applyCounts(original, { type: 'add' })
    expect(result).not.toBe(original)
    expect(original.pending).toBe(0)
  })

  it('swaps counts on status update', () => {
    const start: StatusCounts = { ...emptyCounts(), pending: 3 }
    const result = applyCounts(start, {
      type: 'update',
      from: 'pending',
      to: 'in_progress',
    })
    expect(result.pending).toBe(2)
    expect(result.in_progress).toBe(1)
  })

  it('decrements on remove', () => {
    const start: StatusCounts = { ...emptyCounts(), in_progress: 2 }
    const result = applyCounts(start, {
      type: 'remove',
      status: 'in_progress',
    })
    expect(result.in_progress).toBe(1)
  })

  it('does not go below zero on remove', () => {
    const result = applyCounts(emptyCounts(), {
      type: 'remove',
      status: 'pending',
    })
    expect(result.pending).toBe(0)
  })

  it('does not go below zero on update from', () => {
    const result = applyCounts(emptyCounts(), {
      type: 'update',
      from: 'pending',
      to: 'completed',
    })
    expect(result.pending).toBe(0)
    expect(result.completed).toBe(1)
  })

  it('handles update where from === to (no-op on counts)', () => {
    const start: StatusCounts = { ...emptyCounts(), pending: 3 }
    const result = applyCounts(start, {
      type: 'update',
      from: 'pending',
      to: 'pending',
    })
    expect(result.pending).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────
// rebuildCounts — full scan for self-healing / migration
// ─────────────────────────────────────────────────────────────────

describe('rebuildCounts', () => {
  it('returns empty counts for empty task array', () => {
    expect(rebuildCounts([])).toEqual(emptyCounts())
  })

  it('counts active tasks by status', () => {
    const tasks = [
      { status: 'pending' as const },
      { status: 'pending' as const },
      { status: 'in_progress' as const },
      { status: 'completed' as const },
    ]
    const counts = rebuildCounts(tasks)
    expect(counts.pending).toBe(2)
    expect(counts.in_progress).toBe(1)
    expect(counts.completed).toBe(1)
    expect(counts.failed).toBe(0)
  })

  it('excludes removed tasks', () => {
    const tasks = [
      { status: 'pending' as const },
      { status: 'pending' as const, removedAt: 123456 },
      { status: 'completed' as const },
    ]
    const counts = rebuildCounts(tasks)
    expect(counts.pending).toBe(1)
    expect(counts.completed).toBe(1)
  })

  it('matches deriveStatus behavior for all-completed tasks', () => {
    const tasks = [{ status: 'completed' as const }, { status: 'skipped' as const }]
    const counts = rebuildCounts(tasks)
    expect(deriveStatus(counts)).toBe('completed')
  })
})
