package workers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	staticcompiler "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compiler"
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

func TestWorker_indexProjectAstPatchErrorsWhenStaticSyntaxEnabledWithoutStaticIndexCompiler(t *testing.T) {
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
			rl.on('line', (line) => {
				const req = JSON.parse(line)
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
				process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
			})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(nil)
	defer worker.Close()

	_, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index")
	if err == nil {
		t.Fatal("IndexProjectAstPatch error = nil, want Static Index compiler requirement error")
	}
	if !strings.Contains(err.Error(), "requires a Static Index compiler") {
		t.Fatalf("IndexProjectAstPatch error = %v, want Static Index compiler requirement error", err)
	}
	timing := worker.LastAstTiming()
	if timing.NodeStarted || len(timing.NodeReasons) != 0 {
		t.Fatalf("timing NodeStarted=%v NodeReasons=%v, want no Node start for native worker setup failure", timing.NodeStarted, timing.NodeReasons)
	}
	if timing.NativeOnlyEligible {
		t.Fatalf("timing.NativeOnlyEligible = true, want false when Static Index compiler setup fails")
	}
	if !containsTimingReason(timing.NativeOnlyReasons, projectIndexNativeOnlyReasonStaticIndexCompilerSetup) {
		t.Fatalf("timing.NativeOnlyReasons = %v, want %q", timing.NativeOnlyReasons, projectIndexNativeOnlyReasonStaticIndexCompilerSetup)
	}
}

func TestWorker_indexProjectAstPatchErrorsWhenNativeAstConfigDisabled(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "crux.config.ts"), []byte("export default config({ experimental: { indexer: { nativeAst: false } } })"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "native-disabled-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.method === 'inspectProjectStaticIndexConfig') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-static-index-config',
					artifact: 'projectStaticIndexConfig',
					root: req.root,
					payload: {
						root: req.root,
						nativeAstConfigured: true,
						nativeAstEnabled: false,
						extensions: [],
						diagnostics: []
					}
				}) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	syntaxParser := staticcompiler.New(shellPath(t), fakeIndexerWorker(t))
	defer syntaxParser.Close()
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(syntaxParser)
	defer worker.Close()

	_, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-disabled")
	if err == nil {
		t.Fatal("IndexProjectAstPatch error = nil, want disabled Static Index error")
	}
	if !strings.Contains(err.Error(), "TypeScript bundled fallback has been removed") {
		t.Fatalf("IndexProjectAstPatch error = %v, want removed fallback error", err)
	}
	timing := worker.LastAstTiming()
	if timing.NodeStarted {
		t.Fatalf("timing = %+v, want disabled native config to avoid Node projection", timing)
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
						producer: { name: '@use-crux/indexer/project-indexer', version: 'test' },
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
  *staticIndexPrepare*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":2,"method":"staticIndexPrepare","plan":{"root":"/unused","files":[{"file":"/unused.ts","sourceHash":"indexer-worker-hash"}],"cacheHits":[],"cacheMisses":[{"file":"/unused.ts","sourceHash":"indexer-worker-hash"}]},"diagnostics":[],$TELEMETRY}}\n' "$id" ;;
  *staticIndexAnalyze*) printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":2,"method":"staticIndexAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[],$TELEMETRY}}\n' "$id" ;;
  *staticIndexFinalize*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":2,"method":"staticIndexFinalize","events":[],$TELEMETRY}}\n' "$id" ;;
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
