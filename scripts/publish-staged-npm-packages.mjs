#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseArgs(process.argv.slice(2))
const stageRoot = resolve(repoRoot, options.stageRoot)
const index = await readJson(join(stageRoot, 'packages.json'))
const stagedPackages = sortByDependencyOrder(await readStagedPackages(index.packages))
const results = []

for (const pkg of stagedPackages) {
  const exists = options.skipExisting ? await npmPackageVersionExists(pkg) : false
  if (exists) {
    console.log(`Skipping ${pkg.name}@${pkg.version}; already published.`)
    results.push(resultFor(pkg, 'skipped'))
    continue
  }

  if (options.dryRun) {
    console.log(`Dry run: would publish ${pkg.name}@${pkg.version} from ${pkg.path}`)
    results.push(resultFor(pkg, 'dry-run'))
    continue
  }

  console.log(`Publishing ${pkg.name}@${pkg.version} from ${pkg.path}`)
  run('npm', publishArgs(), { cwd: pkg.packageDir, stdio: 'inherit' })
  results.push(resultFor(pkg, 'published'))
}

await writeJson(join(stageRoot, 'published-packages.json'), {
  generatedAt: new Date().toISOString(),
  packages: results,
})

if (options.gitTag && !options.dryRun) {
  const createdTags = await createMissingGitTags(stagedPackages)
  if (options.gitPushTags && createdTags.length > 0) {
    run('git', ['push', 'origin', ...createdTags.map((tag) => `refs/tags/${tag}`)], { cwd: repoRoot, stdio: 'inherit' })
  }
}

console.log(`Processed ${stagedPackages.length} staged package(s).`)

function parseArgs(args) {
  const parsed = {
    stageRoot: '.tmp/npm-stage',
    access: 'public',
    npmTag: 'latest',
    registry: undefined,
    dryRun: false,
    skipExisting: true,
    gitTag: false,
    gitPushTags: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--stage-root') {
      parsed.stageRoot = args[++index]
    } else if (arg === '--access') {
      parsed.access = args[++index]
    } else if (arg === '--npm-tag') {
      parsed.npmTag = args[++index]
    } else if (arg === '--registry') {
      parsed.registry = args[++index]
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--no-skip-existing') {
      parsed.skipExisting = false
    } else if (arg === '--git-tag') {
      parsed.gitTag = true
    } else if (arg === '--git-push-tags') {
      parsed.gitTag = true
      parsed.gitPushTags = true
    } else if (arg === '--') {
      continue
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/publish-staged-npm-packages.mjs [options]

Options:
  --stage-root <dir>      Read staged packages from this directory. Default: .tmp/npm-stage
  --access <access>       npm publish access. Default: public
  --npm-tag <tag>         npm dist-tag. Default: latest
  --registry <url>        npm registry URL.
  --dry-run               Print what would publish without publishing or tagging.
  --no-skip-existing      Try to publish even when name@version exists on npm.
  --git-tag               Create missing git tags after successful publish processing.
  --git-push-tags         Push newly created tags to origin.
`)
  process.exit(0)
}

async function readStagedPackages(records) {
  const packages = []
  for (const record of records) {
    const packageDir = join(stageRoot, record.path)
    const manifest = await readJson(join(packageDir, 'package.json'))
    packages.push({
      name: manifest.name,
      version: manifest.version,
      manifest,
      packageDir,
      path: record.path,
    })
  }
  return packages
}

function sortByDependencyOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))
  const sorted = []
  const visiting = new Set()
  const visited = new Set()

  for (const pkg of packages) visit(pkg)
  return sorted

  function visit(pkg) {
    if (visited.has(pkg.name)) return
    if (visiting.has(pkg.name)) throw new Error(`Cycle detected while sorting staged packages at ${pkg.name}`)

    visiting.add(pkg.name)
    for (const dependencyName of internalDependencyNames(pkg, byName)) {
      visit(byName.get(dependencyName))
    }
    visiting.delete(pkg.name)
    visited.add(pkg.name)
    sorted.push(pkg)
  }
}

function internalDependencyNames(pkg, byName) {
  const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies']
  const names = new Set()
  for (const field of dependencyFields) {
    for (const name of Object.keys(pkg.manifest[field] ?? {})) {
      if (byName.has(name)) names.add(name)
    }
  }
  return names
}

async function npmPackageVersionExists(pkg) {
  const result = spawnSync('npm', npmViewArgs(pkg), {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (result.status === 0) {
    const version = parseNpmViewVersion(result.stdout)
    return version === pkg.version
  }

  const output = `${result.stdout}\n${result.stderr}`
  if (output.includes('E404') || output.includes('404 Not Found')) return false
  throw new Error(`npm view failed for ${pkg.name}@${pkg.version}\n${output.trim()}`)
}

function npmViewArgs(pkg) {
  const args = ['view', `${pkg.name}@${pkg.version}`, 'version', '--json']
  if (options.registry) args.push('--registry', options.registry)
  return args
}

function parseNpmViewVersion(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function publishArgs() {
  const args = ['publish', '--access', options.access, '--tag', options.npmTag]
  if (options.registry) args.push('--registry', options.registry)
  return args
}

async function createMissingGitTags(packages) {
  const created = []
  for (const pkg of packages) {
    const tag = `${pkg.name}@${pkg.version}`
    if (gitTagExistsLocally(tag)) {
      console.log(`Git tag ${tag} already exists locally.`)
      continue
    }
    if (gitTagExistsRemotely(tag)) {
      console.log(`Git tag ${tag} already exists on origin.`)
      continue
    }
    run('git', ['tag', tag], { cwd: repoRoot, stdio: 'inherit' })
    created.push(tag)
  }
  return created
}

function gitTagExistsLocally(tag) {
  const result = spawnSync('git', ['tag', '--list', tag], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`git tag --list failed for ${tag}`)
  return result.stdout.trim() === tag
}

function gitTagExistsRemotely(tag) {
  const result = spawnSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status === 0) return true
  if (result.status === 2) return false
  throw new Error(`git ls-remote failed while checking tag ${tag}\n${result.stderr.trim()}`)
}

function resultFor(pkg, status) {
  return {
    name: pkg.name,
    version: pkg.version,
    path: pkg.path.replaceAll(sep, '/'),
    status,
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    shell: process.platform === 'win32',
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}
