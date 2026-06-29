/**
 * Tests for the centralized store key namespace.
 */

import { describe, it, expect } from 'vitest'
import { keySpace } from '../../store/keyspace'

describe('keySpace', () => {
  describe('plan', () => {
    it('generates correct key', () => {
      expect(keySpace.plan.key('abc')).toBe('plan:abc')
    })

    it('has correct prefix', () => {
      expect(keySpace.plan.prefix).toBe('plan:')
    })
  })

describe('taskList', () => {
    it('generates correct key', () => {
      expect(keySpace.taskList.key('xyz')).toBe('tasklist:xyz')
    })

    it('has correct prefix', () => {
      expect(keySpace.taskList.prefix).toBe('tasklist:')
    })
  })

describe('task', () => {
    it('generates correct key with list and task ID', () => {
      expect(keySpace.task.key('list1', 'research')).toBe('task:list1:research')
    })

    it('generates correct prefix for a list', () => {
      expect(keySpace.task.prefix('list1')).toBe('task:list1:')
    })
  })

describe('flow', () => {
    it('generates correct key', () => {
      expect(keySpace.flow.key('flow-123')).toBe('crux:flow:flow-123')
    })

    it('has correct prefix', () => {
      expect(keySpace.flow.prefix).toBe('crux:flow:')
    })
  })

describe('signal', () => {
    it('generates correct key', () => {
      expect(keySpace.signal.key('flow-1', 'approval')).toBe('crux:signal:flow-1:approval')
    })

    it('generates correct prefix for a flow', () => {
      expect(keySpace.signal.prefix('flow-1')).toBe('crux:signal:flow-1:')
    })
  })

describe('blackboard', () => {
    it('generates correct key', () => {
      expect(keySpace.blackboard.key('shared')).toBe('blackboard:shared')
    })

    it('has correct prefix', () => {
      expect(keySpace.blackboard.prefix).toBe('blackboard:')
    })
  })

describe('consistency', () => {
    it('no prefix collisions between namespaces', () => {
      const prefixes = [
        keySpace.plan.prefix,
        keySpace.taskList.prefix,
        'task:',
        keySpace.flow.prefix,
        'crux:signal:',
        keySpace.blackboard.prefix,
      ]
      const unique = new Set(prefixes)
      expect(unique.size).toBe(prefixes.length)
    })

    it('key starts with its namespace prefix', () => {
      expect(keySpace.plan.key('x').startsWith(keySpace.plan.prefix)).toBe(true)
      expect(keySpace.taskList.key('x').startsWith(keySpace.taskList.prefix)).toBe(true)
      expect(keySpace.flow.key('x').startsWith(keySpace.flow.prefix)).toBe(true)
      expect(keySpace.blackboard.key('x').startsWith(keySpace.blackboard.prefix)).toBe(true)
    })
  })
})
