import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { runTests } from '@vscode/test-electron'

if (process.platform === 'linux'
  && process.env.DISPLAY === undefined
  && process.env.CRUX_VSCODE_TEST_XVFB !== '1') {
  const result = spawnSync(
    'xvfb-run',
    ['-a', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, CRUX_VSCODE_TEST_XVFB: '1' },
    },
  )
  if (result.error !== undefined) throw result.error
  process.exit(result.status ?? 1)
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const extensionTestsPath = join(packageRoot, 'dist/test/suite.cjs')
const downloadCachePath = join(tmpdir(), 'crux-vscode-test-electron')
const profilePath = await mkdtemp(join(tmpdir(), 'crux-vscode-test-profile-'))
const themeEvidence = process.argv[2] === '--theme-evidence'
  ? process.argv[3]
  : undefined

await build({
  entryPoints: [join(packageRoot, 'test/suite/index.ts')],
  outfile: extensionTestsPath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: false,
})

try {
  await runTests({
    version: '1.90.2',
    cachePath: downloadCachePath,
    extensionDevelopmentPath: packageRoot,
    extensionTestsPath,
    extensionTestsEnv: themeEvidence === undefined
      ? undefined
      : {
          CRUX_PROMPT_TEXT_EVIDENCE_THEME: themeEvidence,
          CRUX_PROMPT_TEXT_EVIDENCE_WAIT_MS:
            process.env.CRUX_PROMPT_TEXT_EVIDENCE_WAIT_MS ?? '12000',
        },
    launchArgs: [
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-gpu',
      `--extensions-dir=${join(profilePath, 'extensions')}`,
      `--user-data-dir=${join(profilePath, 'user-data')}`,
    ],
  })
} finally {
  await rm(profilePath, { recursive: true, force: true })
}
