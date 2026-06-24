package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"
)

func TestWorkerNativeStaticErrorsWhenFinalizeHasNoPatch(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'fallback' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	writeNativeStaticEnabledConfig(t, root)

	script := filepath.Join(t.TempDir(), "native-static-fallback-indexer.mjs")
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
				if (req.method === 'indexProjectAstFromSyntaxRecords') {
					process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
					return
				}
				process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
			})
		`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &nativeStaticNoPatchCompiler{sourceFile: sourceFile}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	_, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-static-fallback")
	if err == nil {
		t.Fatal("IndexProjectAstPatch error = nil, want native static incomplete error")
	}
	if !strings.Contains(err.Error(), "native static AST indexing did not produce a complete patch") {
		t.Fatalf("IndexProjectAstPatch error = %v, want native static incomplete error", err)
	}
	if compiler.finalizeCalls != 1 || compiler.streamParseCalls != 0 {
		t.Fatalf("compiler calls = finalize %d stream %d, want native attempt without syntax fallback", compiler.finalizeCalls, compiler.streamParseCalls)
	}
	timing := worker.LastAstTiming()
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonNativeStaticConfig) {
		t.Fatalf("timing.NodeReasons = %v, want no %q for simple native config", timing.NodeReasons, projectIndexNodeReasonNativeStaticConfig)
	}
	if !containsTimingReason(timing.NodeReasons, projectIndexNodeReasonNativeStaticEmpty) {
		t.Fatalf("timing.NodeReasons = %v, want %q", timing.NodeReasons, projectIndexNodeReasonNativeStaticEmpty)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonSyntaxRecordProjection) {
		t.Fatalf("timing.NodeReasons = %v, want no syntax-record projection", timing.NodeReasons)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) {
		t.Fatalf("timing.NodeReasons = %v, want no static-plan inspection", timing.NodeReasons)
	}
}

type nativeStaticNoPatchCompiler struct {
	sourceFile       string
	prepareCalls     int
	analyzeCalls     int
	finalizeCalls    int
	streamParseCalls int
}

func (c *nativeStaticNoPatchCompiler) NativeStaticPrepare(_ context.Context, request staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	c.prepareCalls++
	return staticprotocol.PrepareResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.PrepareMethod,
		Plan: staticprotocol.Plan{
			Root:        request.Root,
			ProjectName: request.ProjectName,
			Files:       append([]staticprotocol.SourceFile(nil), request.Files...),
			CacheMisses: append([]staticprotocol.SourceFile(nil), request.Files...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   nativeStaticTestTelemetry(len(request.Files), 0, len(request.Files), 0),
	}, nil
}

func (c *nativeStaticNoPatchCompiler) NativeStaticAnalyzeStream(_ context.Context, request staticprotocol.AnalyzeRequest, handle staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return staticprotocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	return nativeStaticTestAnalyzeStream(staticprotocol.AnalyzeResponse{
		ProtocolVersion:       staticprotocol.Version,
		Method:                staticprotocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:native-no-patch"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             nativeStaticTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *nativeStaticNoPatchCompiler) NativeStaticFinalize(context.Context, staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error) {
	c.finalizeCalls++
	return staticprotocol.FinalizeResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.FinalizeMethod,
		Events:          []json.RawMessage{},
		Telemetry:       nativeStaticTestTelemetry(1, 0, 1, 1),
	}, nil
}

func (c *nativeStaticNoPatchCompiler) NativeStaticFinalizeStream(ctx context.Context, request staticprotocol.FinalizeRequest, handle staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error) {
	if !request.Stream {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *nativeStaticNoPatchCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by fallback test")
}

func (c *nativeStaticNoPatchCompiler) ParseFilesStream(_ context.Context, requests []syntax.Request, handle syntax.RecordHandler) error {
	c.streamParseCalls++
	if len(requests) != 1 || requests[0].File != c.sourceFile {
		return fmt.Errorf("stream requests = %+v, want %s", requests, c.sourceFile)
	}
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":%q,"sourceHash":"syntax-fallback-hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, c.sourceFile))
	return handle(0, record)
}

func (c *nativeStaticNoPatchCompiler) Concurrency() int { return 1 }

func (c *nativeStaticNoPatchCompiler) Close() error { return nil }

var _ syntax.Parser = (*nativeStaticNoPatchCompiler)(nil)
var _ syntax.StreamParser = (*nativeStaticNoPatchCompiler)(nil)
var _ StaticCompiler = (*nativeStaticNoPatchCompiler)(nil)
