package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestWorkerStaticIndexErrorsWhenFinalizeHasNoPatch(t *testing.T) {
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
	writeStaticIndexConfig(t, root)

	script := filepath.Join(t.TempDir(), "static-index-fallback-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
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
				process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
			})
		`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &staticIndexNoPatchCompiler{sourceFile: sourceFile}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	_, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index-fallback")
	if err == nil {
		t.Fatal("IndexProjectAstPatch error = nil, want Static Index incomplete error")
	}
	if !strings.Contains(err.Error(), "Static Index AST indexing did not produce a complete patch") {
		t.Fatalf("IndexProjectAstPatch error = %v, want Static Index incomplete error", err)
	}
	if compiler.finalizeCalls != 1 || compiler.streamParseCalls != 0 {
		t.Fatalf("compiler calls = finalize %d stream %d, want native attempt without syntax fallback", compiler.finalizeCalls, compiler.streamParseCalls)
	}
	timing := worker.LastAstTiming()
	if !containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticIndexConfig) {
		t.Fatalf("timing.NodeReasons = %v, want %q for executable config inspection", timing.NodeReasons, projectIndexNodeReasonStaticIndexConfig)
	}
	if !containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticIndexEmpty) {
		t.Fatalf("timing.NodeReasons = %v, want %q", timing.NodeReasons, projectIndexNodeReasonStaticIndexEmpty)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) {
		t.Fatalf("timing.NodeReasons = %v, want no static-plan inspection", timing.NodeReasons)
	}
}

type staticIndexNoPatchCompiler struct {
	sourceFile       string
	prepareCalls     int
	analyzeCalls     int
	finalizeCalls    int
	streamParseCalls int
}

func (c *staticIndexNoPatchCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	c.prepareCalls++
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:        request.Root,
			ProjectName: request.ProjectName,
			Files:       append([]protocol.SourceFile(nil), request.Files...),
			CacheMisses: append([]protocol.SourceFile(nil), request.Files...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   staticIndexTestTelemetry(len(request.Files), 0, len(request.Files), 0),
	}, nil
}

func (c *staticIndexNoPatchCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:native-no-patch"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             staticIndexTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *staticIndexNoPatchCompiler) StaticIndexFinalize(context.Context, protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          []json.RawMessage{},
		Telemetry:       staticIndexTestTelemetry(1, 0, 1, 1),
	}, nil
}

func (c *staticIndexNoPatchCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexNoPatchCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by fallback test")
}

func (c *staticIndexNoPatchCompiler) ParseFilesStream(_ context.Context, requests []frontend.Request, handle frontend.RecordHandler) error {
	c.streamParseCalls++
	if len(requests) != 1 || requests[0].File != c.sourceFile {
		return fmt.Errorf("stream requests = %+v, want %s", requests, c.sourceFile)
	}
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":%q,"sourceHash":"syntax-fallback-hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, c.sourceFile))
	return handle(0, record)
}

func (c *staticIndexNoPatchCompiler) Concurrency() int { return 1 }

func (c *staticIndexNoPatchCompiler) Close() error { return nil }

var _ frontend.Parser = (*staticIndexNoPatchCompiler)(nil)
var _ frontend.StreamParser = (*staticIndexNoPatchCompiler)(nil)
var _ StaticCompiler = (*staticIndexNoPatchCompiler)(nil)
