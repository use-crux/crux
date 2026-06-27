import { readdirSync, readFileSync } from 'node:fs'

/** RSS measurement sampled from the current process tree. */
export interface ProcessTreeMemoryMeasurement {
  /** RSS at the start of the measured operation, in MiB. */
  readonly rssStartMb: number
  /** RSS at the end of the measured operation, in MiB. */
  readonly rssEndMb: number
  /** Highest sampled RSS during the measured operation, in MiB. */
  readonly rssPeakMb: number
}

/**
 * Measures current-process-tree RSS while an async operation runs.
 *
 * Linux hosts use `/proc` to include child workers such as Rust syntax
 * frontends. Other hosts fall back to the current Node process RSS.
 */
export async function measureProcessTreeMemoryDuring<T>(
  run: () => Promise<T>,
  options: { readonly intervalMs?: number } = {},
): Promise<{ readonly value: T; readonly memory: ProcessTreeMemoryMeasurement }> {
  const rssStartMb = currentProcessTreeRssMb()
  let rssPeakMb = rssStartMb
  const sample = (): void => {
    rssPeakMb = Math.max(rssPeakMb, currentProcessTreeRssMb())
  }
  const interval = setInterval(sample, options.intervalMs ?? 25)
  interval.unref()
  try {
    const value = await run()
    sample()
    return {
      value,
      memory: {
        rssStartMb,
        rssEndMb: currentProcessTreeRssMb(),
        rssPeakMb,
      },
    }
  } finally {
    clearInterval(interval)
  }
}

/** Returns current-process-tree RSS in MiB. */
export function currentProcessTreeRssMb(): number {
  return (processTreeRssBytes(process.pid) ?? process.memoryUsage().rss) / 1024 / 1024
}

function processTreeRssBytes(rootPid: number): number | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    return processTreeRssBytesForPid(rootPid, new Set())
  } catch {
    return undefined
  }
}

function processTreeRssBytesForPid(pid: number, visited: Set<number>): number {
  if (visited.has(pid)) return 0
  visited.add(pid)
  return processRssBytes(pid) + childPids(pid).reduce((sum, childPid) => sum + processTreeRssBytesForPid(childPid, visited), 0)
}

function processRssBytes(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
    return match ? Number(match[1]) * 1024 : 0
  } catch {
    return 0
  }
}

function childPids(pid: number): readonly number[] {
  const children = new Set<number>()
  let tids: readonly string[]
  try {
    tids = readdirSync(`/proc/${pid}/task`)
  } catch {
    return []
  }
  for (const tid of tids) {
    try {
      for (const value of readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8').trim().split(/\s+/)) {
        if (value) children.add(Number(value))
      }
    } catch {
      continue
    }
  }
  return [...children].filter((value) => Number.isInteger(value) && value > 0)
}
