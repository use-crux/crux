package projectindexer

func nativeStaticGuardIndexerScript() string {
	return `
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		const pending = new Map()
		function assemble(req) {
			if (!req.requestKind) return req
			if (req.requestKind === 'start') {
				pending.set(req.requestId, { ...req, requestKind: undefined, syntaxRecords: [] })
				return undefined
			}
			if (req.requestKind === 'syntaxRecords') {
				pending.get(req.requestId)?.syntaxRecords.push(...(req.syntaxRecordsBatch ?? []))
				return undefined
			}
			if (req.requestKind === 'done') {
				const completed = pending.get(req.requestId)
				pending.delete(req.requestId)
				return completed
			}
			return undefined
		}
		rl.on('line', (line) => {
			const req = assemble(JSON.parse(line))
			if (!req) return
			if (req.method === 'inspectProjectNativeStaticConfig') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-native-static-config',
					artifact: 'projectNativeStaticConfig',
					root: req.root,
					payload: {
						root: req.root,
						configFile: req.root + '/crux.config.ts',
						nativeAstEnabled: true,
						nativeAstFrontend: 'oxc',
						extensions: [],
						diagnostics: []
					}
				}) + '\n')
				return
			}
			if (req.method === 'extractStaticEvidenceBatch') {
				if ((req.jobs ?? []).length !== 1 || req.jobs[0]?.id !== 'extension-job') {
					process.stdout.write(JSON.stringify({
						protocolVersion: 2,
						type: 'artifact:error',
						transactionId: 'artifact-extension-evidence',
						artifact: 'staticExtensionEvidenceBatch',
						error: { message: 'unexpected evidence jobs: ' + JSON.stringify(req.jobs ?? []) }
					}) + '\n')
					return
				}
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-extension-evidence',
					artifact: 'staticExtensionEvidenceBatch',
					root: req.root,
					payload: {
						method: 'extractStaticEvidenceBatch',
						root: req.root,
						results: [],
						facts: {
							definitions: [{
								id: 'prompt:extension-host',
								kind: 'prompt',
								name: 'extension-host',
								fidelity: 'resolved',
								status: 'active'
							}]
						},
						diagnostics: []
					}
				}) + '\n')
				return
			}
			if (req.method === 'checkStaticRules') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-rule-check',
					artifact: 'staticRuleCheck',
					root: req.root,
					payload: {
						method: 'checkStaticRules',
						root: req.root,
						outputs: [],
						diagnostics: [],
						ruleDescriptors: [],
						facts: {}
					}
				}) + '\n')
				return
			}
			if (req.method !== 'indexProjectAstFromSyntaxRecords') {
				process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
				return
			}
			const tx = 'tx-guard-fallback'
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:start',
				transactionId: tx,
				phase: 'ast',
				root: req.root,
				startedAt: new Date(0).toISOString()
			}) + '\n')
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'fact:batch',
				transactionId: tx,
				sequence: 0,
				facts: [{
					schemaVersion: 1,
					factId: 'definitions:prompt:guard-fallback',
					kind: 'definitions',
					phase: 'ast',
					projectRoot: req.root,
					producer: { name: '@crux/indexer/project-indexer', version: 'test' },
					fidelity: 'authoritative',
					provenance: { kind: 'runtime', attribute: 'test.guardFallback' },
					fact: { id: 'prompt:guard-fallback', kind: 'prompt', name: 'guard-fallback', fidelity: 'resolved', status: 'active' }
				}]
			}) + '\n')
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:done',
				transactionId: tx,
				phase: 'ast',
				patch: {
					schemaVersion: 1,
					phase: 'ast',
					project: { root: req.root, name: req.projectName },
					startedAt: new Date(0).toISOString(),
					finishedAt: new Date(0).toISOString(),
					status: 'ok',
					invalidates: { all: true }
				},
				summary: { factCount: 1 }
			}) + '\n')
		})
	`
}
