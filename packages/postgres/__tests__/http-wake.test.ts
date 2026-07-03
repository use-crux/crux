import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createRuntime,
  createRuntimeHandler,
  genericQueue,
  serverless,
  task,
  type RuntimeFetchHandlers,
  type RuntimeTargetMap,
  type RuntimeWakeMessage,
  type TaskId,
  type WorkId,
} from '@use-crux/core/runtime'
import { Pool } from 'pg'
import { postgres, type PostgresRuntimeStore } from '../runtime'
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

describe('Postgres + HTTP wake runtime path', () => {
  let testDatabase: PostgresTestDatabase
  const stores: PostgresRuntimeStore[] = []
  const schemas: string[] = []

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
  })

  afterAll(async () => {
    try {
      await Promise.all(stores.map((store) => store.close()))
      const cleanup = new Pool({ connectionString: testDatabase.url })
      try {
        for (const schema of schemas) {
          await cleanup.query(
            `DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`,
          )
        }
      } finally {
        await cleanup.end()
      }
    } finally {
      await testDatabase.close()
    }
  })

  it('processes signed HTTP wakes, deduplicates redelivery, and rejects tampering before writes', async () => {
    const store = await createStore()
    const delivered: RuntimeWakeMessage[] = []
    let executed = 0
    const embedDocument = task('postgres-http-embed-document', {
      run: () => {
        executed += 1
      },
    })
    const targetMap: RuntimeTargetMap = {
      [embedDocument.name]: embedDocument,
    }
    let handlers!: RuntimeFetchHandlers
    const server = createServer((request, response) => {
      void dispatchFetchHandler(request, response, handlers)
    })
    const baseUrl = await listen(server)
    const runtimeDefinition = serverless({
      store,
      publicUrl: baseUrl,
      namespace: 'tenant-a',
      wake: genericQueue({
        secret: '0123456789abcdef0123456789abcdef',
        enqueue: async (message) => {
          delivered.push(message)
          const response = await fetch(message.url, {
            method: 'POST',
            headers: message.headers,
            body: message.body,
          })
          if (!response.ok && response.status !== 409) {
            throw new Error(`HTTP wake failed with status ${response.status}.`)
          }
        },
      }),
    })
    handlers = createRuntimeHandler({
      runtime: runtimeDefinition,
      targets: [embedDocument],
      newWorkId: () => 'work_http_1' as WorkId,
    })
    const runtime = createRuntime({
      runtime: runtimeDefinition,
      targets: targetMap,
      newWorkId: () => 'work_http_1' as WorkId,
      startMaintenance: false,
    })

    try {
      const work = await runtime.kernel.enqueueTask({
        namespace: 'tenant-a',
        taskId: 'task_http_1' as TaskId,
        targetId: embedDocument.targetId,
        input: {},
      })
      await runtime.dispatcher.nudge()

      await expect(
        store.state.getWork(work.workId, { namespace: 'tenant-a' }),
      ).resolves.toMatchObject({ status: 'completed' })
      expect(executed).toBe(1)

      const duplicate = await fetch(`${baseUrl}/api/crux`, {
        method: 'POST',
        headers: delivered[0]!.headers,
        body: delivered[0]!.body,
      })
      expect(duplicate.status).toBe(200)
      expect(executed).toBe(1)

      const tampered = await fetch(`${baseUrl}/api/crux`, {
        method: 'POST',
        body: delivered[0]!.body,
      })
      expect(tampered.status).toBe(401)
      expect(executed).toBe(1)
    } finally {
      runtime.dispose()
      await closeServer(server)
    }
  })

  async function createStore(): Promise<PostgresRuntimeStore> {
    const schema = `crux_runtime_http_${Date.now()}_${schemas.length}`
    schemas.push(schema)
    const store = postgres({ url: testDatabase.url, schema })
    stores.push(store)
    await store.setup.apply()
    return store
  }
})

async function dispatchFetchHandler(
  request: IncomingMessage,
  response: ServerResponse,
  handlers: RuntimeFetchHandlers,
): Promise<void> {
  const fetchRequest = await toFetchRequest(request)
  const fetchResponse =
    request.method === 'GET'
      ? await handlers.GET(fetchRequest)
      : await handlers.POST(fetchRequest)
  response.writeHead(
    fetchResponse.status,
    Object.fromEntries(fetchResponse.headers.entries()),
  )
  response.end(await fetchResponse.text())
}

async function toFetchRequest(request: IncomingMessage): Promise<Request> {
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await readBody(request)
  return new Request(`http://${request.headers.host}${request.url ?? '/'}`, {
    method: request.method,
    headers: headersFromNode(request),
    body,
  })
}

function headersFromNode(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    }
  }
  return headers
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate HTTP test port.')
  }
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
