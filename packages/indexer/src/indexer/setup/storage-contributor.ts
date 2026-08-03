import {
  defineSetupContributor,
  type SetupAction,
  type SetupContext,
  type SetupFinding,
} from '@use-crux/core/setup'
import type {
  Storage,
  StorageSetupFinding,
  StorageSetupPort,
} from '@use-crux/core/storage'
import { redactSetupText } from './redact'

const DOCS_URL = 'https://cruxjs.dev/docs/guides/setup#storage-setup'

type SetupStorage = Storage & { readonly setup: StorageSetupPort }

function mapFinding(finding: StorageSetupFinding): SetupFinding {
  const resource = redactSetupText(finding.resource)
  const message = redactSetupText(finding.message)
  const remediation =
    finding.remediation === undefined
      ? undefined
      : redactSetupText(finding.remediation)
  return {
    contributorId: 'storage',
    code: finding.code,
    resource,
    severity: 'error',
    message,
    docsUrl: DOCS_URL,
    ...(remediation === undefined ? {} : { remediation }),
    agentPrompt: [
      'Configure Crux Storage setup.',
      `Finding: ${finding.code} on ${resource}.`,
      message,
      ...(remediation === undefined
        ? []
        : [`Apply this remediation: ${remediation}`]),
    ].join('\n'),
  }
}

/** Adapt configured Storage setup into the project-wide setup contract. */
export function createStorageSetupContributor(storage: SetupStorage) {
  return defineSetupContributor({
    id: 'storage',
    inspect: async (_project: SetupContext) =>
      (await storage.setup.check()).findings.map(mapFinding),
    plan: async (_project: SetupContext) => {
      const result = await storage.setup.check()
      return result.ok ? [] : [storageSetupAction()]
    },
    apply: async (_action: SetupAction, _project: SetupContext) => {
      const result = await storage.setup.apply()
      return {
        ok: result.ok,
        actionId: 'storage.apply-setup',
        findings: result.findings.map(mapFinding),
      }
    },
  })
}

function storageSetupAction(): SetupAction {
  return {
    id: 'storage.apply-setup',
    contributorId: 'storage',
    classification: 'safe-additive',
    title: 'Create Storage resources',
    description: 'Apply the configured Storage adapter safe additive setup.',
  }
}
