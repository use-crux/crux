import { useMemo } from 'react'
import type { MemoryEventData, AgentEventData, BlackboardUpdateEvent } from '@/types'

export interface MemoryEntry {
  key: string
  content: string
  metadata?: Record<string, unknown>
  confidence?: number
  createdAt?: string
  updatedAt?: string
  score?: number
}

export interface MemoryInstance {
  memoryId: string
  memoryType: 'working' | 'episodic' | 'semantic' | 'block' | 'blackboard'
  blockId?: string
  blockKind?: string
  namespaceHash?: string
  readCount: number
  writeCount: number
  lastActivity: number
  currentState: unknown | null
  entries: MemoryEntry[]
  events: MemoryEventData[]
  /** For blackboard: history of snapshots with fieldsChanged */
  blackboardHistory: Array<{
    timestamp: number
    fieldsChanged: string[]
    snapshot: Record<string, unknown>
    traceId?: string
  }>
}

export function useMemoryInstances(
  memoryEvents: MemoryEventData[],
  agentEvents: AgentEventData[],
): Map<string, MemoryInstance> {
  return useMemo(() => {
    const map = new Map<string, MemoryInstance>()

    function getOrCreate(
      id: string,
      type: 'working' | 'episodic' | 'semantic' | 'block' | 'blackboard',
      event?: MemoryEventData,
    ): MemoryInstance {
      let inst = map.get(id)
      if (!inst) {
        inst = {
          memoryId: id,
          memoryType: type,
          blockId: event?.blockId,
          blockKind: event?.blockKind,
          namespaceHash: event?.namespaceHash,
          readCount: 0,
          writeCount: 0,
          lastActivity: 0,
          currentState: null,
          entries: [],
          events: [],
          blackboardHistory: [],
        }
        map.set(id, inst)
      } else if (event) {
        inst.blockId ??= event.blockId
        inst.blockKind ??= event.blockKind
        inst.namespaceHash ??= event.namespaceHash
      }
      return inst
    }

    // Process memory events (newest-first in the array, so iterate in reverse for chronological)
    const chronological = [...memoryEvents].reverse()
    const entryMaps = new Map<string, Map<string, MemoryEntry>>()

    // Structural shape of a memory entry inside a snapshot array (from list/recall).
    type SnapshotEntry = {
      key?: string
      content?: string
      metadata?: Record<string, unknown>
      confidence?: number
      createdAt?: string | Date
      updatedAt?: string | Date
      score?: number
    }

    for (const event of chronological) {
      const type = event.memoryType ?? 'working'
      const inst = getOrCreate(event.memoryId, type, event)
      inst.events.push(event)
      inst.lastActivity = Math.max(inst.lastActivity, event.timestamp)

      if (event._kind === 'read') {
        inst.readCount++
        const snapshot = event.snapshot
        if (snapshot != null) {
          if (type === 'working' || (type === 'block' && event.blockKind === 'working')) {
            inst.currentState = snapshot
          } else if (Array.isArray(snapshot)) {
            // List/recall returns authoritative entry arrays
            const entryMap = new Map<string, MemoryEntry>()
            for (const raw of snapshot) {
              const e = raw as SnapshotEntry
              if (e && e.key) {
                entryMap.set(e.key, {
                  key: e.key,
                  content: e.content ?? '',
                  metadata: e.metadata,
                  confidence: e.confidence,
                  createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
                  updatedAt: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : e.updatedAt,
                  score: e.score,
                })
              }
            }
            entryMaps.set(inst.memoryId, entryMap)
          }
        }
      } else {
        inst.writeCount++
        const snapshot = event.snapshot
        // `entryKey` lives on MemoryWriteEvent. The MemoryEventData intersection
        // prevents `_kind`-based narrowing, so access via a typed structural cast.
        const entryKey = (event as { entryKey?: string }).entryKey

        if (type === 'working') {
          inst.currentState = snapshot ?? null
        } else if (type === 'block' && event.blockKind === 'working') {
          inst.currentState = snapshot ?? null
        } else if (event.operation === 'delete' && entryKey) {
          const entryMap = entryMaps.get(inst.memoryId)
          if (entryMap) entryMap.delete(entryKey)
        } else if (event.operation === 'clear' || event.operation === 'prune') {
          entryMaps.set(inst.memoryId, new Map())
        } else if (snapshot != null && typeof snapshot === 'object' && 'key' in snapshot) {
          const entry = snapshot as SnapshotEntry
          if (entry.key) {
            let entryMap = entryMaps.get(inst.memoryId)
            if (!entryMap) {
              entryMap = new Map()
              entryMaps.set(inst.memoryId, entryMap)
            }
            entryMap.set(entry.key, {
              key: entry.key,
              content: entry.content ?? '',
              metadata: entry.metadata,
              confidence: entry.confidence,
            })
          }
        }
      }
    }

    // Convert entry maps to arrays
    for (const [memoryId, entryMap] of entryMaps) {
      const inst = map.get(memoryId)
      if (inst) inst.entries = Array.from(entryMap.values())
    }

    // Process blackboard events from agentEvents
    const agentChronological = [...agentEvents].reverse()
    for (const event of agentChronological) {
      if (event._kind !== 'blackboard') continue
      const bb = event as BlackboardUpdateEvent & { _kind: 'blackboard' }
      const inst = getOrCreate(bb.boardId, 'blackboard')
      inst.writeCount++
      inst.lastActivity = Math.max(inst.lastActivity, bb.timestamp)
      if (bb.snapshot) {
        inst.currentState = bb.snapshot
        inst.blackboardHistory.push({
          timestamp: bb.timestamp,
          fieldsChanged: bb.fieldsChanged,
          snapshot: bb.snapshot,
          traceId: bb.traceId,
        })
      }
    }

    // Reverse events back so they're newest-first for display
    for (const inst of map.values()) {
      inst.events.reverse()
      // Sort blackboard history newest-first
      inst.blackboardHistory.sort((a, b) => b.timestamp - a.timestamp)
    }

    return map
  }, [memoryEvents, agentEvents])
}
