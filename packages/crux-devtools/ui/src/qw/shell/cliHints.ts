/**
 * "Use the CLI" hints for actions that don't have a write-API in V1.
 *
 * Each action returns a toast payload so any button can fire a uniform
 * "this isn't wired yet — here's how to do it from the CLI" message.
 */

export type CliHintKey =
  | 'new-run'
  | 'new-experiment'
  | 'new-dataset'
  | 'add-case'
  | 'import-cases'
  | 'new-scorer'
  | 'record-session'
  | 'new-comparison'
  | 'columns'
  | 'export'
  | 'new-version'
  | 'edit-scorers'
  | 'open-cases'
  | 'promotion-rules'

export const CLI_HINTS: Record<CliHintKey, { title: string; message: string }> = {
  'new-run': {
    title: 'Trigger a run',
    message: 'Runs are captured automatically when your app calls generate()/stream() — no UI trigger needed.',
  },
  'new-experiment': {
    title: 'Start an experiment',
    message: 'Run `crux quality experiments` or call `experiment().run()` from your test runner.',
  },
  'new-dataset': {
    title: 'Create a dataset',
    message: 'Drop a JSON file at .crux/quality/suites/<id>.json or run `crux quality suites new`.',
  },
  'add-case': {
    title: 'Add case',
    message: 'POSTs to /api/quality/suites/<id>/cases — a guided form is coming next.',
  },
  'import-cases': {
    title: 'Import cases',
    message: 'Paste a JSON array of {input, expected} into your suite file under .crux/quality/suites/.',
  },
  'new-scorer': {
    title: 'New scorer',
    message: 'Define one with llmJudge() or a custom function and register it on the suite.',
  },
  'record-session': {
    title: 'Record cassette',
    message: 'Run your suite with CASSETTE_MODE=record, or use `crux quality cassettes record`.',
  },
  'new-comparison': {
    title: 'New comparison',
    message: 'Promote a baseline first, then run a candidate experiment — comparisons land here automatically.',
  },
  columns: {
    title: 'Columns',
    message: 'Column picker UI is next. Use ⌘K search for now.',
  },
  export: {
    title: 'Export',
    message: 'Use `crux quality runs --json` to export filtered runs to stdout.',
  },
  'new-version': {
    title: 'New dataset version',
    message: 'Bump the version field in .crux/quality/suites/<id>.json — versions are cheap, just immutable snapshots.',
  },
  'edit-scorers': {
    title: 'Edit scorers',
    message: 'Scorer rows are derived from experiments. Edit the suite source to add or remove scorers.',
  },
  'open-cases': {
    title: 'Open cases',
    message: 'Click anywhere on the card to drill into the dataset.',
  },
  'promotion-rules': {
    title: 'Promotion rules',
    message: 'Configured per-target in your suite definition. UI editor is coming next.',
  },
}
