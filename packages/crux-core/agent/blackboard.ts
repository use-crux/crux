/**
 * Blackboard — shared typed scratchpad for multi-agent coordination.
 *
 * Creates a schema-validated key-value board backed by `CruxStore`.
 * Multiple agents can read/write individual fields, subscribe to changes,
 * and expose the board as prompt context or focused agent tools.
 *
 * @module
 */

import { z } from 'zod'
import type { CruxStore, ToolConfig } from '../store/types'
import type { Context } from '../types'
import type { ToolDef } from '../types/tool'
import { inMemoryCruxStore } from '../store/memory'
import { context } from '../context'
import { getRuntime } from '../runtime'
import { observe } from '../observability'
import { registerInspectableResource } from '../runtime-bridge/resources'

// ── Types ───────────────────────────────────────────────────────────

type Listener = (boardId: string, fieldsChanged: string[]) => void

/** Options for rendering a blackboard as prompt context. */
export interface BlackboardContextOptions {
  priority?: number
}

/** Options for exposing focused blackboard tools. */
export interface BlackboardToolOptions {
  /**
   * Prefix generated tool names to avoid collisions when multiple blackboards
   * are injected into the same prompt.
   *
   * `prefix: "research"` yields:
   * readResearchBlackboard, writeResearchBlackboard, patchResearchBlackboard, clearResearchBlackboard.
   */
  prefix?: string
}

/**
 * Configuration for `blackboard()`.
 *
 * The schema must be a `z.ZodObject` — fields are validated individually on
 * `set()`/`patch()`, and field-name autocomplete relies on the object shape.
 */
export interface BlackboardConfig<T extends z.ZodObject<z.ZodRawShape>> {
  /** Unique identifier for this blackboard instance. */
  id: string
  /** Zod object schema defining the typed fields on the board. */
  schema: T
  /** Storage backend. Defaults to `inMemoryCruxStore()` (ephemeral). */
  store?: CruxStore
  /** Optional callback fired after every successful write (for devtools wiring). */
  onUpdate?: Listener
  /** Custom tool guidance appended to generated blackboard tool descriptions. */
  tool?: ToolConfig
  /** Focused tool options used by `.asTools()` and direct prompt `use`. */
  tools?: BlackboardToolOptions
}

/** A blackboard instance with field-level read/write + context/tool bridges. */
export interface Blackboard<T> {
  /** Discriminant tag for prompt `use` integration. */
  readonly _tag: 'Blackboard'
  /** The unique identifier for this blackboard. */
  readonly id: string

  /** Get a single field value. Returns undefined if unset. */
  get<K extends keyof T & string>(field: K): Promise<T[K] | undefined>

  /** Get the full board state. Returns null if never written. */
  getAll(): Promise<Partial<T> | null>

  /** Set a single field value (merges with existing state). */
  set<K extends keyof T & string>(field: K, value: T[K]): Promise<void>

  /** Merge multiple fields at once. */
  patch(fields: Partial<T>): Promise<void>

  /** Clear the entire board. */
  clear(): Promise<void>

  /**
   * Register a change listener. Called synchronously after set() or patch().
   * Returns an unsubscribe function.
   */
  subscribe(fn: Listener): () => void

  /** Create a Context that injects the current board state into a prompt. */
  asContext(options?: BlackboardContextOptions): Context<z.ZodType<{}>>

  /**
   * Create focused tool definitions for each blackboard operation.
   *
   * Returns individual tools for readBlackboard, writeBlackboard, patchBlackboard,
   * and clearBlackboard, each with self-contained descriptions and typed parameters.
   */
  asTools(options?: BlackboardToolOptions): Record<string, ToolDef>
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function blackboardToolNames(options?: BlackboardToolOptions): {
  read: string
  write: string
  patch: string
  clear: string
} {
  const prefix = options?.prefix ? toPascalCase(options.prefix) : ''
  return {
    read: prefix ? `read${prefix}Blackboard` : 'readBlackboard',
    write: prefix ? `write${prefix}Blackboard` : 'writeBlackboard',
    patch: prefix ? `patch${prefix}Blackboard` : 'patchBlackboard',
    clear: prefix ? `clear${prefix}Blackboard` : 'clearBlackboard',
  }
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined
  try {
    return JSON.parse(JSON.stringify(z.toJSONSchema(schema as z.ZodType))) as Record<string, unknown>
  } catch {
    return undefined
  }
}

// ── Implementation ──────────────────────────────────────────────────

/**
 * Create a shared blackboard for multi-agent coordination.
 *
 * @param config - Configuration with id, Zod schema, optional store and onUpdate callback.
 * @returns A `Blackboard` with get/set/patch/clear/subscribe/asContext/asTools methods.
 */
export function blackboard<T extends z.ZodObject<z.ZodRawShape>>(config: BlackboardConfig<T>): Blackboard<z.infer<T>> {
  type State = z.infer<T>

  const store = config.store ?? inMemoryCruxStore()
  const storeKey = `blackboard:${config.id}`
  const listeners = new Set<Listener>()
  const toolGuidance = config.tool?.description ? `\n\nGuidance:\n${config.tool.description}` : ''

  // Access per-field validators from the schema shape.
  // The constraint guarantees `schema.shape` is a record of zod types.
  const shape = config.schema.shape as Record<string, z.ZodType>

  registerInspectableResource({
    resource: `blackboard:${config.id}`,
    kind: 'blackboard',
    description: `Blackboard: ${config.id}`,
    operations: ['get', 'list'],
    store,
    defaultKey: storeKey,
    defaultPrefix: storeKey,
    metadata: {
      blackboardId: config.id,
      schema: zodToJsonSchema(config.schema),
      backend: config.store ? 'configured' : 'inMemory',
    },
  })

  function snapshotSize(snapshot: unknown): number {
    try {
      return JSON.stringify(snapshot)?.length ?? 0
    } catch {
      return 0
    }
  }

  function emitSnapshot(kind: 'read' | 'write', operation: string, snapshot: unknown, fieldsChanged?: string[]) {
    const observedContext = observe.captureContext()
    const primitive = kind === 'read' ? 'memory.read' : 'memory.write'
    const artifactId = observe.artifact({
      kind: 'memory.snapshot',
      contentType: 'application/json',
      encoding: 'json',
      preview: snapshot,
      sizeBytes: snapshotSize(snapshot),
      attributes: {
        memoryId: config.id,
        memoryType: 'blackboard',
        blockId: config.id,
        blockKind: 'blackboard',
        operation,
        ...(fieldsChanged ? { fieldsChanged } : {}),
      },
    })
    if (!observedContext?.currentSpanId || !artifactId) return
    observe.edge({
      edgeType: primitive,
      from:
        kind === 'read' ? { kind: 'artifact', id: artifactId } : { kind: 'span', id: observedContext.currentSpanId },
      to: kind === 'read' ? { kind: 'span', id: observedContext.currentSpanId } : { kind: 'artifact', id: artifactId },
      attributes: { memoryId: config.id, memoryType: 'blackboard', operation },
    })
  }

  function spanAttributes(operation: string, extra?: Record<string, unknown>) {
    return {
      memoryId: config.id,
      memoryType: 'blackboard',
      blockId: config.id,
      blockKind: 'blackboard',
      operation,
      sourceDefinitionId: `blackboard:${config.id}`,
      schema: zodToJsonSchema(config.schema),
      backend: config.store ? 'configured' : 'inMemory',
      conflictPolicy: 'last-writer-wins',
      ...extra,
    }
  }

  async function notify(fieldsChanged: string[]): Promise<void> {
    for (const fn of listeners) {
      fn(config.id, fieldsChanged)
    }
    config.onUpdate?.(config.id, fieldsChanged)
    const current = await rawGetAll()
    getRuntime().instrumentationHooks?.onBlackboardUpdate?.({
      boardId: config.id,
      fieldsChanged,
      snapshot: (current ?? {}) as Record<string, unknown>,
    })
  }

  async function rawGetAll(): Promise<Partial<State> | null> {
    const entry = await store.get(storeKey)
    if (!entry) return null
    try {
      const content = entry.content as string
      return JSON.parse(content) as Partial<State>
    } catch (err) {
      getRuntime().instrumentationHooks?.onBlackboardUpdate?.({
        boardId: config.id,
        fieldsChanged: [],
        snapshot: {
          _error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      })
      return null
    }
  }

  async function getAll(): Promise<Partial<State> | null> {
    return observe.span(
      {
        name: `${config.id}.getAll`,
        family: 'memory',
        primitive: 'memory.read',
        attributes: spanAttributes('getAll'),
      },
      async () => {
        const state = await rawGetAll()
        emitSnapshot('read', 'getAll', state)
        return state
      },
    )
  }

  async function writeState(state: Record<string, unknown>): Promise<void> {
    await store.set(storeKey, {
      content: JSON.stringify(state),
      metadata: { type: 'blackboard', memoryId: config.id },
      updatedAt: Date.now(),
    })
  }

  const board: Blackboard<State> = {
    _tag: 'Blackboard',
    id: config.id,

    get: async <K extends keyof State & string>(field: K): Promise<State[K] | undefined> => {
      return observe.span(
        {
          name: `${config.id}.get`,
          family: 'memory',
          primitive: 'memory.read',
          attributes: spanAttributes('get', { field }),
        },
        async () => {
          const state = await rawGetAll()
          const value = state?.[field] as State[K] | undefined
          emitSnapshot('read', 'get', { field, value })
          return value
        },
      )
    },

    getAll,

    set: async <K extends keyof State & string>(field: K, value: State[K]): Promise<void> => {
      // Per-field validation
      if (shape[field]) {
        shape[field].parse(value)
      }
      await observe.span(
        {
          name: `${config.id}.set`,
          family: 'memory',
          primitive: 'memory.write',
          attributes: spanAttributes('set', { fieldsChanged: [field] }),
        },
        async () => {
          const state = (await rawGetAll()) ?? {}
          ;(state as Record<string, unknown>)[field] = value
          await writeState(state as Record<string, unknown>)
          await notify([field])
          emitSnapshot('write', 'set', state, [field])
        },
      )
    },

    async patch(fields: Partial<State>): Promise<void> {
      const entries = Object.entries(fields as Record<string, unknown>)
      // Per-field validation
      for (const [key, value] of entries) {
        if (shape[key]) {
          shape[key].parse(value)
        }
      }
      await observe.span(
        {
          name: `${config.id}.patch`,
          family: 'memory',
          primitive: 'memory.write',
          attributes: spanAttributes('patch', { fieldsChanged: entries.map(([k]) => k) }),
        },
        async () => {
          const state = ((await rawGetAll()) ?? {}) as Record<string, unknown>
          for (const [key, value] of entries) {
            state[key] = value
          }
          await writeState(state)
          await notify(entries.map(([k]) => k))
          emitSnapshot(
            'write',
            'patch',
            state,
            entries.map(([k]) => k),
          )
        },
      )
    },

    async clear(): Promise<void> {
      await observe.span(
        {
          name: `${config.id}.clear`,
          family: 'memory',
          primitive: 'memory.write',
          attributes: spanAttributes('clear', { fieldsChanged: ['*'] }),
        },
        async () => {
          await store.delete(storeKey)
          await notify(['*'])
          emitSnapshot('write', 'clear', null, ['*'])
        },
      )
    },

    subscribe(fn: Listener): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },

    asContext(options?: BlackboardContextOptions): Context<z.ZodType<{}>> {
      const priority = options?.priority ?? 70

      return context({
        id: `blackboard:${config.id}`,
        description: `Blackboard: ${config.id}`,
        priority,
        system: async () => {
          const state = await rawGetAll()
          if (!state || Object.keys(state).length === 0) return ''
          return `## Shared Blackboard (${config.id})\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\``
        },
      })
    },

    asTools(options?: BlackboardToolOptions) {
      const names = blackboardToolNames(options ?? config.tools)
      return {
        [names.read]: {
          description: `Read the current state of blackboard "${config.id}". Returns all fields as a JSON object, or "null" if the blackboard is empty. Optionally read a single field by name.${toolGuidance}`,
          parameters: z.object({
            field: z.string().optional().describe('Read a single field by name. Omit to read the entire blackboard.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            if (args.field) {
              const val = await board.get(args.field as keyof State & string)
              return val !== undefined ? JSON.stringify(val) : 'undefined'
            }
            const state = await board.getAll()
            return state ? JSON.stringify(state) : 'null'
          },
        } satisfies ToolDef,

        [names.write]: {
          description: `Write a single field on blackboard "${config.id}". Sets the field to the provided value; other fields are unchanged.${toolGuidance}`,
          parameters: z.object({
            field: z.string().describe('The field name to write, e.g. "status" or "summary".'),
            value: z.unknown().describe('The value to set for this field. Must match the field schema.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            const fieldKey = args.field as keyof State & string
            const fieldSchema = shape[args.field as string]
            const value = fieldSchema ? fieldSchema.parse(args.value) : args.value
            await board.set(fieldKey, value as State[typeof fieldKey])
            return 'OK'
          },
        } satisfies ToolDef,

        [names.patch]: {
          description: `Partially update blackboard "${config.id}" by merging multiple fields at once. Only the provided fields are overwritten; other fields are preserved.${toolGuidance}`,
          parameters: z.object({
            fields: z
              .record(z.string(), z.unknown())
              .describe('Key-value pairs to merge into the blackboard, e.g. { "status": "done", "score": 42 }.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            const raw = args.fields as Record<string, unknown>
            const validated: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(raw)) {
              const fieldSchema = shape[k]
              validated[k] = fieldSchema ? fieldSchema.parse(v) : v
            }
            await board.patch(validated as Partial<State>)
            return 'OK'
          },
        } satisfies ToolDef,

        [names.clear]: {
          description: `Clear blackboard "${config.id}" entirely, removing all stored fields. This action cannot be undone.${toolGuidance}`,
          parameters: z.object({}),
          async execute(): Promise<string> {
            await board.clear()
            return 'OK'
          },
        } satisfies ToolDef,
      }
    },
  }

  return board
}
