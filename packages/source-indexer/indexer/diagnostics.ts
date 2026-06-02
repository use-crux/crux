import { relative } from 'node:path'
import type { CatalogDiagnostic } from '@crux/core/catalog'
import { fingerprint } from './definitions'
import { sourceForFile } from './ast/snippets'

type CatalogDiagnosticInput =
  | { kind: 'static-only'; configFile?: string }
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

function catalogDiagnostic(input: CatalogDiagnosticInput): CatalogDiagnostic {
  switch (input.kind) {
    case 'static-only':
      return {
        id: 'diagnostic:catalog:static-only',
        severity: 'warning',
        code: 'catalog.static_only',
        message: 'Project Catalog is running in static-only fallback mode because import-based discovery timed out or was disabled.',
        source: input.configFile ? sourceForFile(input.configFile) : undefined,
        suggestedFix: 'Keep crux.config.* and discovered definition modules import-safe in CRUX_INDEX=1 mode for full-fidelity catalog metadata.',
      }
    case 'config-not-found':
      return {
        id: 'diagnostic:catalog:no-config',
        severity: 'warning',
        code: 'catalog.config_not_found',
        message: 'No crux.config.ts/js/mjs file was found; Project Catalog will use source-file discovery only.',
        suggestedFix: 'Add a crux.config.ts at the project root for zero-config prompt/context/tool discovery.',
      }
    case 'multiple-configs':
      return {
        id: 'diagnostic:catalog:multiple-configs',
        severity: 'info',
        code: 'catalog.multiple_configs',
        message: `Found ${input.count} Crux config files; indexing ${relative(input.root, input.configFile)} for runtime registry data in this slice.`,
        source: sourceForFile(input.configFile),
        suggestedFix: 'Pass configPath to reindex a specific workspace, or add workspace catalog config when indexing multiple packages.',
      }
    case 'config-unrecognized':
      return {
        id: `diagnostic:catalog:config-shape:${fingerprint(input.configFile)}`,
        severity: 'warning',
        code: 'catalog.config_unrecognized',
        message: 'Crux config was imported, but it did not export a config() instance or legacy eval runner config.',
        source: sourceForFile(input.configFile),
      }
    case 'config-import-failed':
      return {
        id: `diagnostic:catalog:config-import:${fingerprint(input.configFile)}`,
        severity: 'error',
        code: 'catalog.config_import_failed',
        message: `Could not import Crux config: ${input.message}`,
        source: sourceForFile(input.configFile),
        suggestedFix: 'Ensure config imports are side-effect safe in CRUX_INDEX=1 mode.',
      }
    case 'suite-json-invalid':
      return {
        id: `diagnostic:catalog:suite-json:${fingerprint(input.jsonFile)}`,
        severity: 'warning',
        code: 'catalog.suite_json_invalid',
        message: 'Suite JSON was found but does not match the portable suite shape.',
        source: sourceForFile(input.jsonFile),
      }
    case 'suite-json-read-failed':
      return {
        id: `diagnostic:catalog:suite-json-read:${fingerprint(input.jsonFile)}`,
        severity: 'error',
        code: 'catalog.suite_json_read_failed',
        message: `Could not read suite JSON: ${input.message}`,
        source: sourceForFile(input.jsonFile),
      }
    case 'module-import-failed':
      return {
        id: `diagnostic:catalog:module-import:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'catalog.module_import_failed',
        message: `Could not import catalog candidate ${relative(input.root, input.file)}: ${input.message}`,
        source: sourceForFile(input.file),
        suggestedFix: 'Keep eval and suite modules import-safe; move runtime-only work inside test execution.',
      }
    case 'rich-import-failed':
      return {
        id: `diagnostic:catalog:rich-import:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'catalog.rich_import_failed',
        message: `Could not import rich catalog candidate ${relative(input.root, input.file)}: ${input.message}`,
        source: sourceForFile(input.file),
        suggestedFix: 'Keep exported Crux definitions import-safe in CRUX_INDEX=1 mode, or rely on partial static catalog discovery.',
      }
    case 'static-parse-failed':
      return {
        id: `diagnostic:catalog:static-parse:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'catalog.static_parse_failed',
        message: `Could not statically inspect ${relative(input.root, input.file)}: ${input.message}`,
        source: sourceForFile(input.file),
      }
    case 'source-too-large':
      return {
        id: `diagnostic:catalog:source-too-large:${fingerprint(input.file)}`,
        severity: 'warning',
        code: 'catalog.source_too_large',
        message: `Skipped ${relative(input.root, input.file)} because it is ${(input.bytes / 1024 / 1024).toFixed(1)} MB and too large to safely parse during local catalog indexing.`,
        source: sourceForFile(input.file),
        suggestedFix: 'Move generated artifacts out of authored source files, or split large Crux definitions into smaller import-safe modules.',
      }
  }
}

export function staticOnlyDiagnostic(configFile: string | undefined): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'static-only', configFile })
}

export function configNotFoundDiagnostic(): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'config-not-found' })
}

export function multipleConfigsDiagnostic(root: string, configFile: string, count: number): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'multiple-configs', root, configFile, count })
}

export function configUnrecognizedDiagnostic(configFile: string): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'config-unrecognized', configFile })
}

export function configImportFailedDiagnostic(configFile: string, message: string): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'config-import-failed', configFile, message })
}

export function suiteJsonInvalidDiagnostic(jsonFile: string): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'suite-json-invalid', jsonFile })
}

export function suiteJsonReadFailedDiagnostic(jsonFile: string, message: string): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'suite-json-read-failed', jsonFile, message })
}

export function moduleImportFailedDiagnostic(root: string, file: string, message: string): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'module-import-failed', root, file, message })
}

export function richImportFailedDiagnostic(root: string, file: string, message: string): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'rich-import-failed', root, file, message })
}

export function staticParseFailedDiagnostic(root: string, file: string, message: string): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'static-parse-failed', root, file, message })
}

export function sourceTooLargeDiagnostic(root: string, file: string, bytes: number): CatalogDiagnostic {
  return catalogDiagnostic({ kind: 'source-too-large', root, file, bytes })
}
