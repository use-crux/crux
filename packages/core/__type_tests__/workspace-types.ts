import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { workspace } from '../workspace'
import type { Context } from '../prompt/context-types'
import type { WorkspaceArtifact, WorkspaceContent, WorkspaceJsonContent, WorkspaceTools } from '../workspace'

const ws = workspace({ id: 'research', namespace: 'thread:1' })

const defaultTools = ws.asTools()
expectTypeOf<keyof typeof defaultTools>().toEqualTypeOf<
  | 'listWorkspace'
  | 'readWorkspaceFile'
  | 'writeWorkspaceFile'
  | 'editWorkspaceFile'
  | 'renameWorkspaceFile'
  | 'grepWorkspace'
>()
expectTypeOf(defaultTools).toEqualTypeOf<WorkspaceTools>()

const researchTools = ws.asTools({ prefix: 'research', delete: true })
expectTypeOf<keyof typeof researchTools>().toEqualTypeOf<
  | 'listResearchWorkspace'
  | 'readResearchWorkspaceFile'
  | 'writeResearchWorkspaceFile'
  | 'editResearchWorkspaceFile'
  | 'renameResearchWorkspaceFile'
  | 'grepResearchWorkspace'
  | 'deleteResearchWorkspaceFile'
>()

const context = ws.asContext()
expectTypeOf(context).toEqualTypeOf<Context<z.ZodObject<{}>>>()

expectTypeOf<Awaited<ReturnType<typeof ws.finalize>>>().toEqualTypeOf<WorkspaceArtifact>()
expectTypeOf<Awaited<ReturnType<typeof ws.artifacts>>>().toEqualTypeOf<readonly WorkspaceArtifact[]>()

expectTypeOf<string>().toExtend<WorkspaceContent>()
expectTypeOf<{ readonly ok: true }>().toExtend<WorkspaceContent>()
expectTypeOf<readonly ['a', 1]>().toExtend<WorkspaceContent>()
expectTypeOf<number>().toExtend<WorkspaceContent>()
expectTypeOf<Extract<WorkspaceJsonContent, string>>().toEqualTypeOf<never>()
