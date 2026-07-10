export interface PostgresStoreFaults {
  failAfterWrites?: number
  writeCount: number
  crashBeforeConfirm: boolean
}

export function createPostgresStoreFaults(): PostgresStoreFaults {
  return { writeCount: 0, crashBeforeConfirm: false }
}

export function beginFaultWindow(faults: PostgresStoreFaults): void {
  faults.writeCount = 0
}

export function recordWrite(faults: PostgresStoreFaults): void {
  faults.writeCount += 1
  if (
    faults.failAfterWrites !== undefined &&
    faults.writeCount > faults.failAfterWrites
  ) {
    faults.failAfterWrites = undefined
    throw new Error('Injected transaction failure')
  }
}
