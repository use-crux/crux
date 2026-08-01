import { expect, test } from 'vitest'
import { runConnectedKnowledgeConformance } from '../../src/knowledge'
import { inMemoryStorage } from '../../src/storage'

runConnectedKnowledgeConformance({
  createStorage: () => inMemoryStorage(),
  test,
  expect,
})
