package workers

func staticIndexGuardIndexerScript() string {
	return `
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.method === 'inspectProjectStaticIndexConfig') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 3,
					type: 'artifact:done',
					transactionId: 'artifact-static-index-config',
					artifact: 'projectStaticIndexConfig',
					root: req.root,
					payload: {
						root: req.root,
						configFile: req.root + '/crux.config.ts',
						extensions: [],
						diagnostics: []
					}
				}) + '\n')
				return
			}
			if (req.method === 'extractStaticEvidenceBatch') {
				if ((req.jobs ?? []).length !== 1 || req.jobs[0]?.id !== 'extension-job') {
					process.stdout.write(JSON.stringify({
						protocolVersion: 3,
						type: 'artifact:error',
						transactionId: 'artifact-extension-evidence',
						artifact: 'staticExtensionEvidenceBatch',
						error: { message: 'unexpected evidence jobs: ' + JSON.stringify(req.jobs ?? []) }
					}) + '\n')
					return
				}
				process.stdout.write(JSON.stringify({
					protocolVersion: 3,
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
					protocolVersion: 3,
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
			process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
		})
	`
}
