import { runAdmissionSuite } from './admission-suite'

const format = process.argv[2]
if (!format) throw new Error('An admission format is required.')
const containmentUnavailable = process.argv.includes('--containment-unavailable')

process.stdout.write(JSON.stringify(await runAdmissionSuite({ formats: [format], determinismRuns: true, containmentUnavailable })))
