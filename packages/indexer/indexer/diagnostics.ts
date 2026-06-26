import { relative } from 'node:path'
import type { IndexDiagnostic } from '@use-crux/core/project-index'
import { fingerprint } from './definitions'
import { sourceForFile } from './ast/snippets'

type IndexDiagnosticInput =
  | { kind: 'source-only'; configFile?: string }
  | { kind: 'config-not-found' }
  | { kind: 'multiple-configs'; root: string; configFile: string; count: number }
  | { kind: 'config-unrecognized'; configFile: string }
  | { kind: 'config-import-failed'; configFile: string; message: string }
  | { kind: 'suite-json-invalid'; jsonFile: string }
  | { kind: 'suite-json-read-failed'; jsonFile: string; message: string }
  | { kind: 'module-import-failed'; root: string; file: string; message: string }
  | { kind: 'rich-import-failed'; root: string; file: string; message: string }
  | { kind: 'static-parse-failed'; root: string; file: string; message: string }
  | { kind: 'source-too-large'; root: string; file: string; bytes: number }

function indexDiagnostic(input: IndexDiagnosticInput): IndexDiagnostic {
  switch (input.kind) {
    case 'source-only':
      return {
        id: 'diagnostic:index:source-only',
        severity: 'warning',
        code: 'index.source_only',
        message: 'Project Index is running in source-only mode because runtime imports were disabled or degraded.',
        source: input.configFile ? sourceForFile(input.configFile) : undefined,
        suggestedFix:
          'Use config-policy or runtime-rich resolution only when config policy or runtime evidence is required.',
      }
    case 'config-not-found':
      return {
        id: 'diagnostic:index:no-config',
        severity: 'info',
        code: 'index.config_not_found',
        message: 'No crux.config.ts/js/mjs file was found; Project Index is using source discovery only.',
        suggestedFix:
          'Add Crux config only when you need explicit policy, trust, persistence, telemetry, or overrides.',
      }
    case 'multiple-configs':
      return {
        id: 'diagnostic:index:multiple-configs',
        severity: 'info',
        code: 'index.multiple_configs',
        message: `Found ${input.count} Crux config files; indexing ${relative(input.root, input.configFile)} for runtime registry data in this slice.`,
        source: sourceForFile(input.configFile),
        suggestedFix:
          'Pass configPath to reindex a specific workspace, or add workspace index config when indexing multiple packages.',
      }
    case 'config-unrecognized':
      return {
        id: `diagnostic:index:config-shape:${fingerprint(input.configFile)}`,
        severity: 'warning',
        code: 'index.config_unrecognized',
        message: 'Crux config was imported, but it did not export a config() instance or legacy eval runner config.',
        source: sourceForFile(input.configFile),
      }
    case 'config-import-failed':
      return {
        id: `diagnostic:index:config-import:${fingerprint(input.configFile)}`,
        severity: 'error',
        code: 'index.config_import_failed',
        message: `Could not import Crux config: ${input.message}`,
        source: sourceForFile(input.configFile),
        suggestedFix: 'Ensure config imports are side-effect safe in CRUX_INDEX=1 mode.',
      }
    case 'suite-json-invalid':
      return {
        id: `diagnostic:index:suite-json:${fingerprint(input.jsonFile)}`,
        severity: 'warning',
        code: 'index.suite_json_invalid',
        message: 'Suite JSON was found but does not match the portable suite shape.',
        source: sourceForFile(input.jsonFile),
      }
    case 'suite-json-read-failed':
      return {
        id: `diagnostic:index:suite-json-read:${fingerprint(input.jsonFile)}`,
        severity: 'error',
        code: 'index.suite_json_read_failed',
        message: `Could not read suite JSON: ${input.message}`,
        source: sourceForFile(input.jsonFile),
      }
    case 'module-import-failed':
      return {
        id: `diagnostic:index:module-import:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'index.module_import_failed',
        message: `Could not import index candidate ${relative(input.root, input.file)}: ${input.message}`,
        source: sourceForFile(input.file),
        suggestedFix: 'Keep eval and suite modules import-safe; move runtime-only work inside test execution.',
      }
    case 'rich-import-failed':
      return {
        id: `diagnostic:index:rich-import:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'index.rich_import_failed',
        message: `Could not import rich index candidate ${relative(input.root, input.file)}: ${input.message}`,
        source: sourceForFile(input.file),
        suggestedFix:
          'Keep exported Crux definitions import-safe in CRUX_INDEX=1 mode, or rely on partial static index discovery.',
      }
    case 'static-parse-failed':
      return {
        id: `diagnostic:index:static-parse:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'index.static_parse_failed',
        message: `Could not statically inspect ${relative(input.root, input.file)}: ${input.message}`,
        source: sourceForFile(input.file),
      }
    case 'source-too-large':
      return {
        id: `diagnostic:index:source-too-large:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'index.source_too_large',
        message: `Skipped ${relative(input.root, input.file)} because it is ${(input.bytes / 1024 / 1024).toFixed(1)} MB and too large to safely parse during local index indexing.`,
        source: sourceForFile(input.file),
        suggestedFix:
          'Move generated artifacts out of authored source files, or split large Crux definitions into smaller import-safe modules.',
      }
  }
}

export function sourceOnlyDiagnostic(configFile: string | undefined): IndexDiagnostic {
  return indexDiagnostic({ kind: 'source-only', configFile })
}

export function configNotFoundDiagnostic(): IndexDiagnostic {
  return indexDiagnostic({ kind: 'config-not-found' })
}

export function multipleConfigsDiagnostic(root: string, configFile: string, count: number): IndexDiagnostic {
  return indexDiagnostic({ kind: 'multiple-configs', root, configFile, count })
}

export function configUnrecognizedDiagnostic(configFile: string): IndexDiagnostic {
  return indexDiagnostic({ kind: 'config-unrecognized', configFile })
}

export function configImportFailedDiagnostic(configFile: string, message: string): IndexDiagnostic {
  return indexDiagnostic({ kind: 'config-import-failed', configFile, message })
}

export function moduleImportFailedDiagnostic(root: string, file: string, message: string): IndexDiagnostic {
  return indexDiagnostic({ kind: 'module-import-failed', root, file, message })
}

export function richImportFailedDiagnostic(root: string, file: string, message: string): IndexDiagnostic {
  return indexDiagnostic({ kind: 'rich-import-failed', root, file, message })
}

export function staticParseFailedDiagnostic(root: string, file: string, message: string): IndexDiagnostic {
  return indexDiagnostic({ kind: 'static-parse-failed', root, file, message })
}

export function sourceTooLargeDiagnostic(root: string, file: string, bytes: number): IndexDiagnostic {
  return indexDiagnostic({ kind: 'source-too-large', root, file, bytes })
}
