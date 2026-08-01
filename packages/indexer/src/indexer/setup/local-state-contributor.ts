import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineSetupContributor, type SetupAction, type SetupContext, type SetupFinding } from '@use-crux/core/setup'

const CONTRIBUTOR_ID = 'local-state'
const ACTION_ID = 'local-state.gitignore-crux'
const GITIGNORE = '.gitignore'
const CANONICAL_RULE = '.crux/'

export function createLocalStateSetupContributor() {
  return defineSetupContributor({
    id: CONTRIBUTOR_ID,
    inspect: async (project) =>
      (await gitignoreEffectivelyIgnoresLocalState(project.root)) ? [] : [localStateFinding()],
    plan: async (project) => ((await gitignoreEffectivelyIgnoresLocalState(project.root)) ? [] : [localStateAction()]),
    apply: async (_action: SetupAction, project: SetupContext) => {
      await appendLocalStateGitignoreRule(project.root)
      return { ok: true, actionId: ACTION_ID, findings: [] }
    },
  })
}

async function appendLocalStateGitignoreRule(root: string): Promise<void> {
  const path = join(root, GITIGNORE)
  const existing = await readGitignoreBytes(path)
  if (gitignoreEffectivelyIgnoresSource(existing.toString('utf8'))) return

  const prefix = existing.length === 0 || existing.at(-1) === 0x0a ? Buffer.alloc(0) : Buffer.from('\n')
  await appendFile(path, Buffer.concat([prefix, Buffer.from(`${CANONICAL_RULE}\n`)]))
}

async function gitignoreEffectivelyIgnoresLocalState(root: string): Promise<boolean> {
  return gitignoreEffectivelyIgnoresSource((await readGitignoreBytes(join(root, GITIGNORE))).toString('utf8'))
}

async function readGitignoreBytes(path: string): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (error) {
    if (isMissingFile(error)) return Buffer.alloc(0)
    throw error
  }
}

function gitignoreEffectivelyIgnoresSource(source: string): boolean {
  let ignored = false
  for (const rawLine of source.split(/\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const negated = line.startsWith('!')
    const pattern = negated ? line.slice(1).trim() : line
    if (isLocalStateRule(pattern)) {
      ignored = !negated
    }
  }
  return ignored
}

function isLocalStateRule(pattern: string): boolean {
  return pattern === '.crux' || pattern === '.crux/' || pattern === '/.crux' || pattern === '/.crux/'
}

function localStateFinding(): SetupFinding {
  return {
    contributorId: CONTRIBUTOR_ID,
    code: 'LOCAL_STATE_NOT_GITIGNORED',
    resource: GITIGNORE,
    severity: 'warning',
    message: 'Project-local Crux state is not ignored by the root .gitignore.',
    remediation: 'Add `.crux/` to the root .gitignore.',
    agentPrompt: 'Append `.crux/` to the root .gitignore so project-local Crux state is not committed.',
  }
}

function localStateAction(): SetupAction {
  return {
    id: ACTION_ID,
    contributorId: CONTRIBUTOR_ID,
    classification: 'safe-additive',
    title: 'Ignore Crux local state',
    description: 'Append `.crux/` to the root .gitignore.',
    remediation: 'Add `.crux/` to the root .gitignore.',
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
