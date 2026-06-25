package host

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/compiler"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorker_resolveProjectModelUsesArtifactStreamProtocol(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "project-model-artifact-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'resolveProjectModel' || req.protocolVersion !== 2) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-error',
					artifact: 'projectModel',
					error: { message: 'expected V2 resolveProjectModel request' }
				}) + '\n')
				return
			}
			if (req.staticOnly !== undefined) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-error',
					artifact: 'projectModel',
					error: { message: 'resolveProjectModel must not send staticOnly' }
				}) + '\n')
				return
			}
			if (req.resolutionMode !== 'config-policy') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-error',
					artifact: 'projectModel',
					error: { message: 'resolveProjectModel must use config-policy, got ' + req.resolutionMode }
				}) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'artifact:done',
				transactionId: 'artifact-project-model',
				artifact: 'projectModel',
				root: req.root,
				payload: {
					root: { value: req.root, provenance: { kind: 'filesystem', path: req.root, convention: 'resolved project root' } },
					resolutionMode: { value: req.resolutionMode, provenance: { kind: 'runtime', attribute: 'project-model.resolutionMode' } },
					configFiles: [],
					sourceRoots: [],
					ignoredPaths: [],
					definitions: [],
					relations: [],
					quality: {
						persistenceRoot: { value: req.root + '/.crux/quality', provenance: { kind: 'filesystem', path: req.root, convention: 'default quality persistence root' } },
						includeGlobs: [],
						excludeGlobs: [],
						evaluationFiles: []
					},
					diagnostics: []
				}
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()

	model, err := worker.ResolveProjectModel(context.Background(), t.TempDir(), "", "inspect-project")
	if err != nil {
		t.Fatalf("ResolveProjectModel error = %v, want artifact stream success", err)
	}
	if !strings.Contains(string(model), `"resolutionMode"`) {
		t.Fatalf("project model response = %s, want JSON project model", model)
	}
}

func TestWorker_indexProjectAstFromSyntaxRecordsUsesProvidedRecords(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	dir := t.TempDir()
	script := filepath.Join(dir, "provided-record-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
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
				const current = pending.get(req.requestId)
				if (!current) throw new Error('syntax request did not start')
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
			const record = req.syntaxRecords?.[0]
			if (
				req.method !== 'indexProjectAstFromSyntaxRecords' ||
				req.protocolVersion !== 2 ||
				req.resolutionMode !== 'source-only' ||
				record?.file !== req.root + '/src/writer.ts' ||
				record?.frontend?.name !== 'oxc-rust'
			) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'provided syntax record request was not forwarded' }
				}) + '\n')
				return
			}
			const tx = 'tx-provided-ast'
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
					facts: { definitions: [] },
					invalidates: { all: true }
				},
				summary: { factCount: 0 }
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()

	recordBytes, err := json.Marshal(map[string]any{
		"schemaVersion":     1,
		"frontend":          map[string]any{"name": "oxc-rust", "version": "test"},
		"file":              filepath.Join(root, "src", "writer.ts"),
		"sourceHash":        "hash",
		"imports":           []any{},
		"matches":           []any{},
		"localInitializers": []any{},
		"diagnostics":       []any{},
	})
	if err != nil {
		t.Fatalf("marshal syntax record: %v", err)
	}
	record := json.RawMessage(recordBytes)
	patch, err := worker.IndexProjectAstFromSyntaxRecordsPatch(context.Background(), root, "", "provided-records", []json.RawMessage{record})
	if err != nil {
		t.Fatalf("IndexProjectAstFromSyntaxRecordsPatch error = %v", err)
	}
	if patch.Phase != "ast" || patch.Project.Root != root || patch.Project.Name != "provided-records" {
		t.Fatalf("patch = %+v, want AST patch for provided-records project", patch)
	}
}

func TestWorker_indexProjectAstPatchErrorsWhenNativeAstEnabledWithoutStaticIndexCompiler(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "writer.ts"), []byte("export const writer = prompt({ id: 'native' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	writeStaticIndexEnabledConfig(t, root)

	dir := t.TempDir()
	script := filepath.Join(dir, "native-project-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
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
				const current = pending.get(req.requestId)
				if (!current) throw new Error('syntax request did not start')
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
			if (req.method === 'indexProjectAst') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'unexpected TypeScript AST fallback' }
				}) + '\n')
				return
			}
			if (req.method === 'inspectProjectStaticIndexConfig') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-static-index-config',
					artifact: 'projectStaticIndexConfig',
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
			if (req.method === 'indexProjectAstFromSyntaxRecords') {
				const record = req.syntaxRecords?.[0]
				if (record?.sourceHash !== 'indexer-worker-hash' || record?.frontend?.name !== 'oxc-rust') {
					process.stdout.write(JSON.stringify({
						protocolVersion: 2,
						type: 'phase:error',
						transactionId: 'tx-error',
						phase: 'ast',
						error: { message: 'native syntax record was not projected' }
					}) + '\n')
					return
				}
				const tx = 'tx-native-ast'
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
						factId: 'definitions:prompt:native',
						kind: 'definitions',
						phase: 'ast',
						projectRoot: req.root,
						producer: { name: '@crux/indexer/project-indexer', version: 'test' },
						fidelity: 'authoritative',
						provenance: { kind: 'runtime', attribute: 'test.native' },
						fact: { id: 'prompt:native', kind: 'prompt', name: 'native', fidelity: 'resolved', status: 'active' }
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
				return
			}
			process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	syntaxParser := &streamOnlySyntaxParser{}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(syntaxParser)
	defer worker.Close()

	_, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index")
	if err == nil {
		t.Fatal("IndexProjectAstPatch error = nil, want Static Index compiler requirement error")
	}
	if !strings.Contains(err.Error(), "requires a Static Index compiler") {
		t.Fatalf("IndexProjectAstPatch error = %v, want Static Index compiler requirement error", err)
	}
}

func TestWorker_indexProjectAstPatchFallsBackWhenNativeAstConfigDisabled(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	dir := t.TempDir()
	script := filepath.Join(dir, "native-disabled-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
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
						files: [req.root + '/src/writer.ts'],
						skipped: [],
						callNames: ['prompt'],
						constructorNames: ['Agent'],
						syntaxFrontend: { name: 'oxc-rust', version: 'test' },
						staticInterests: {}
					}
				}) + '\n')
				return
			}
			if (req.method === 'indexProjectAstFromSyntaxRecords') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'native syntax path should be disabled by config' }
				}) + '\n')
				return
			}
			if (req.method !== 'indexProjectAst') {
				process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
				return
			}
			const tx = 'tx-ts-ast'
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
					factId: 'definitions:prompt:ts',
					kind: 'definitions',
					phase: 'ast',
					projectRoot: req.root,
					producer: { name: '@crux/indexer/project-indexer', version: 'test' },
					fidelity: 'authoritative',
					provenance: { kind: 'runtime', attribute: 'test.typescript' },
					fact: { id: 'prompt:ts', kind: 'prompt', name: 'ts', fidelity: 'resolved', status: 'active' }
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

	syntaxParser := compiler.New(shellPath(t), fakeIndexerWorker(t))
	defer syntaxParser.Close()
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(syntaxParser)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-disabled")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:ts" {
		t.Fatalf("definitions = %+v, want TypeScript AST fallback result", patch.Facts.Definitions)
	}
	timing := worker.LastAstTiming()
	if !containsTimingReason(timing.NodeReasons, projectIndexNodeReasonTypeScriptStaticCompiler) {
		t.Fatalf("timing.NodeReasons = %v, want %q", timing.NodeReasons, projectIndexNodeReasonTypeScriptStaticCompiler)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) ||
		containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticIndexConfig) {
		t.Fatalf("timing.NodeReasons = %v, want no native planning Node reason without config", timing.NodeReasons)
	}
	if !timing.NodeStarted || timing.NativeOnlyEligible {
		t.Fatalf("timing = %+v, want node-required native-only-ineligible fallback", timing)
	}
}

func TestWorker_corruptAstStreamDoesNotUpdateServiceStore(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	dir := t.TempDir()
	script := filepath.Join(dir, "corrupt-stream-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			const events = [
				{
					protocolVersion: 2,
					type: 'phase:start',
					transactionId: 'tx-ast',
					phase: 'ast',
					root: req.root,
					startedAt: new Date(0).toISOString()
				},
				{
					protocolVersion: 2,
					type: 'fact:batch',
					transactionId: 'tx-ast',
					sequence: 0,
					facts: [{
						schemaVersion: 1,
						factId: 'definitions:prompt:corrupt',
						kind: 'definitions',
						phase: 'ast',
						projectRoot: req.root,
						producer: { name: '@crux/indexer/project-indexer', version: 'test' },
						fact: { id: 'prompt:corrupt', kind: 'prompt', name: 'corrupt', fidelity: 'partial', status: 'active' }
					}]
				},
				{
					protocolVersion: 2,
					type: 'phase:done',
					transactionId: 'tx-ast',
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
					summary: { factCount: 0 }
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	state := store.NewStore()
	service := devtools.NewService(state, nil)
	defer service.Shutdown()
	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()
	service.WithProjectIndexer(worker)
	service.RegisterIndexSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:previous", Kind: "prompt", Name: "previous", Fidelity: "resolved", Status: "active"},
		},
	})

	if _, err := service.ReindexProject(context.Background(), root, "", "project"); err == nil {
		t.Fatal("ReindexProject error = nil, want corrupt stream rejected")
	}

	index := state.GetIndex()
	if findTestDefinition(index.Definitions, "prompt:corrupt") != nil {
		t.Fatalf("definitions = %+v, want corrupt streamed fact ignored", index.Definitions)
	}
	if findTestDefinition(index.Definitions, "prompt:previous") == nil {
		t.Fatalf("definitions = %+v, want previous index preserved", index.Definitions)
	}
}

func fakeIndexerWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":false,"reasons":["test-skeleton"]},"timings":[],"files":{"selected":1,"cacheHits":0,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":0,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":0,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *staticIndexPrepare*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":1,"method":"staticIndexPrepare","plan":{"root":"/unused","files":[{"file":"/unused.ts","sourceHash":"indexer-worker-hash"}],"cacheHits":[],"cacheMisses":[{"file":"/unused.ts","sourceHash":"indexer-worker-hash"}]},"diagnostics":[],$TELEMETRY}}\n' "$id" ;;
  *staticIndexAnalyze*) printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":1,"method":"staticIndexAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[],$TELEMETRY}}\n' "$id" ;;
  *staticIndexFinalize*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":1,"method":"staticIndexFinalize","events":[],$TELEMETRY}}\n' "$id" ;;
  *'"files"'*callNames*prompt*) printf '{"id":%s,"type":"record","index":0,"record":{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":"/unused.ts","sourceHash":"indexer-worker-hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n{"id":%s,"type":"done","count":1}\n' "$id" "$id" ;;
  *callNames*prompt*) printf '{"id":%s,"ok":true,"record":{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":"/unused.ts","sourceHash":"indexer-worker-hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n' "$id" ;;
  *) printf '{"id":1,"ok":false,"error":"unexpected indexer worker request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "indexer-worker.sh", script)
}

func findTestDefinition(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}
