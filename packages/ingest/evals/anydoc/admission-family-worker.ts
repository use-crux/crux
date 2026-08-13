import { runAdmissionSuite } from './admission-suite'

const format = process.argv[2]
if (!format) throw new Error('An admission format is required.')
process.stdout.write(JSON.stringify(await runAdmissionSuite({ formats: [format], determinismRuns: true })))
