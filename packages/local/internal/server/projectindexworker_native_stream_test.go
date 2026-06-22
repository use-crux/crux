package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestProjectIndexWorker_indexProjectAstPatchStreamsNativeSyntaxRecords(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	for _, name := range []string{"one.ts", "two.ts"} {
		if err := os.WriteFile(filepath.Join(root, "src", name), []byte("export const value = prompt({ id: 'x' })"), 0o600); err != nil {
			t.Fatalf("write source: %v", err)
		}
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "native-stream-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		const pending = new Map()

		function error(message) {
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:error',
				transactionId: 'tx-error',
				phase: 'ast',
				error: { message }
			}) + '\n')
		}

		function assemble(req) {
			if (!req.requestKind) return req
			if (req.requestKind === 'start') {
				if ((req.syntaxRecords?.length ?? 0) > 0 || (req.syntaxRecordsBatch?.length ?? 0) > 0) {
					error('start request carried syntax records')
					return undefined
				}
				pending.set(req.requestId, { ...req, requestKind: undefined, syntaxRecords: [], chunkCount: 0 })
				return undefined
			}
			if (req.requestKind === 'syntaxRecords') {
				const current = pending.get(req.requestId)
				if (!current) throw new Error('syntax request did not start')
				current.chunkCount++
				current.syntaxRecords.push(...(req.syntaxRecordsBatch ?? []))
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
			if (req.method === 'inspectProjectStaticSyntaxPlan') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-static-plan',
					artifact: 'projectStaticSyntaxPlan',
					root: req.root,
					payload: {
						root: req.root,
						projectName: req.projectName,
						files: [req.root + '/src/one.ts', req.root + '/src/two.ts'],
						skipped: [],
						callNames: ['prompt'],
						constructorNames: ['Agent'],
						syntaxFrontend: { name: 'oxc-rust', version: 'test' },
						nativeAstEnabled: true,
						staticInterests: {}
					}
				}) + '\n')
				return
			}
			if (req.method !== 'indexProjectAstFromSyntaxRecords') return error('unexpected method: ' + req.method)
			const files = new Set(req.syntaxRecords.map((record) => record.file))
			if (req.chunkCount < 1 || req.syntaxRecords.length !== 2 || !files.has(req.root + '/src/one.ts') || !files.has(req.root + '/src/two.ts')) {
				return error('native syntax records were not streamed as chunks')
			}
			const tx = 'tx-native-stream'
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
					factId: 'definitions:prompt:native-stream',
					kind: 'definitions',
					phase: 'ast',
					projectRoot: req.root,
					producer: { name: '@crux/indexer/project-indexer', version: 'test' },
					fidelity: 'authoritative',
					provenance: { kind: 'runtime', attribute: 'test.nativeStream' },
					fact: { id: 'prompt:native-stream', kind: 'prompt', name: 'native-stream', fidelity: 'resolved', status: 'active' }
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
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	parser := &streamOnlyProjectSyntaxParser{}
	worker := NewProjectIndexWorker(script)
	worker.WithProjectSyntaxWorker(parser)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-stream")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:native-stream" {
		t.Fatalf("definitions = %+v, want streamed native definition", patch.Facts.Definitions)
	}
	if len(parser.requests) != 2 {
		t.Fatalf("stream parser requests = %d, want 2", len(parser.requests))
	}
}

type streamOnlyProjectSyntaxParser struct {
	requests []ProjectSyntaxParseRequest
}

func (p *streamOnlyProjectSyntaxParser) ParseFile(context.Context, ProjectSyntaxParseRequest) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called for stream-capable syntax parser")
}

func (p *streamOnlyProjectSyntaxParser) ParseFilesStream(_ context.Context, requests []ProjectSyntaxParseRequest, handle ProjectSyntaxRecordHandler) error {
	p.requests = append([]ProjectSyntaxParseRequest(nil), requests...)
	for index := len(requests) - 1; index >= 0; index-- {
		request := requests[index]
		record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":%q,"sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, request.File))
		if err := handle(index, record); err != nil {
			return err
		}
	}
	return nil
}

func (p *streamOnlyProjectSyntaxParser) Concurrency() int {
	return 1
}

func (p *streamOnlyProjectSyntaxParser) Close() error {
	return nil
}

var _ ProjectSyntaxParser = (*streamOnlyProjectSyntaxParser)(nil)
var _ ProjectSyntaxBatchStreamParser = (*streamOnlyProjectSyntaxParser)(nil)
