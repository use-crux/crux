package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestWorkerStaticIndexCutoverUsesFinalizePatchEvents(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	sourceFile := filepath.Join(srcDir, "writer.ts")
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'static-index-cutover' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	writeStaticIndexConfig(t, root)

	dir := t.TempDir()
	script := filepath.Join(dir, "static-index-cutover-indexer.mjs")
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
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &staticIndexCutoverCompiler{root: root, sourceFile: sourceFile}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index-cutover")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:static-index-cutover" {
		t.Fatalf("definitions = %+v, want Static Index finalize result", patch.Facts.Definitions)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 || compiler.finalizeCalls != 1 {
		t.Fatalf("Static Index calls = prepare %d analyze %d finalize %d, want 1 each", compiler.prepareCalls, compiler.analyzeCalls, compiler.finalizeCalls)
	}
	if compiler.finalizeStreams != 1 {
		t.Fatalf("finalize stream calls = %d, want 1", compiler.finalizeStreams)
	}
	if compiler.parseCalls != 0 || compiler.batchParseCalls != 0 || compiler.streamParseCalls != 0 {
		t.Fatalf("syntax-record parsing was called: parse=%d batch=%d stream=%d", compiler.parseCalls, compiler.batchParseCalls, compiler.streamParseCalls)
	}
	if !staticIndexAnalyzeFilesContain(compiler.analyzeFiles, sourceFile) {
		t.Fatalf("analyze files = %+v, want selected source %s", compiler.analyzeFiles, sourceFile)
	}

	timing := worker.LastAstTiming()
	if !containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticIndexConfig) {
		t.Fatalf("timing.NodeReasons = %v, want %q for executable config inspection", timing.NodeReasons, projectIndexNodeReasonStaticIndexConfig)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) {
		t.Fatalf("timing.NodeReasons = %v, want no %q", timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection)
	}
	if !reflect.DeepEqual(timing.NativeOnlyReasons, timing.NodeReasons) {
		t.Fatalf("timing.NativeOnlyReasons = %v, want NodeReasons %v", timing.NativeOnlyReasons, timing.NodeReasons)
	}
	if !timing.NodeStarted || timing.NativeOnlyEligible || !timing.UsedStaticIndex {
		t.Fatalf("timing = %+v, want config-hosted Static Index execution", timing)
	}
}

type staticIndexCutoverCompiler struct {
	root             string
	sourceFile       string
	prepareCalls     int
	analyzeCalls     int
	finalizeCalls    int
	finalizeStreams  int
	parseCalls       int
	batchParseCalls  int
	streamParseCalls int
	analyzeFiles     []protocol.AnalyzeFile
}

func (c *staticIndexCutoverCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	c.prepareCalls++
	if request.Root != c.root {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare root = %q, want %q", request.Root, c.root)
	}
	if !stringSliceContains(request.CallNames, "prompt") {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare call names = %v, want prompt", request.CallNames)
	}
	if !stringSliceContains(request.ConstructorNames, "Agent") {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare constructor names = %v, want Agent", request.ConstructorNames)
	}
	if !staticIndexPrepareFilesContain(request.Files, c.sourceFile) {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare files = %+v, want hashed source file", request.Files)
	}
	if len(request.ExtensionHost) == 0 {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare missing static host")
	}
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:                     request.Root,
			ProjectName:              request.ProjectName,
			Files:                    append([]protocol.SourceFile(nil), request.Files...),
			CacheHits:                []protocol.SourceFile{},
			CacheMisses:              append([]protocol.SourceFile(nil), request.Files...),
			CallNames:                append([]string(nil), request.CallNames...),
			CallInterests:            append([]frontend.CallInterest(nil), request.CallInterests...),
			ConstructorNames:         append([]string(nil), request.ConstructorNames...),
			ConstructorInterests:     append([]frontend.ConstructorInterest(nil), request.ConstructorInterests...),
			PruneNativeFactCallNames: append([]string(nil), request.PruneNativeFactCallNames...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   staticIndexTestTelemetry(1, 0, 1, 0),
	}, nil
}

func (c *staticIndexCutoverCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	c.analyzeFiles = append([]protocol.AnalyzeFile(nil), request.Files...)
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	if len(request.ExtensionEvidenceInterests) == 0 {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze missing static interests")
	}
	if !stringSliceContains(request.Plan.CallNames, "prompt") {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze plan call names = %v, want prompt", request.Plan.CallNames)
	}
	if !staticIndexAnalyzeFilesContain(request.Files, c.sourceFile) {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze files = %+v, want selected file", request.Files)
	}
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","id":"prompt:static-index-cutover"}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             staticIndexTestTelemetry(1, 0, 1, len(request.Files)),
	}, handle)
}

func (c *staticIndexCutoverCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	if request.Stream {
		c.finalizeStreams++
	}
	if len(request.NativeFacts) != 1 {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize native facts = %d, want 1", len(request.NativeFacts))
	}
	if len(request.RelationSpecs) != 0 {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize relation specs = %s, want Rust defaults", request.RelationSpecs)
	}
	if len(request.ExtensionFacts) != 1 ||
		!bytes.Contains(request.ExtensionFacts[0], []byte("sourceGraph")) {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize extension facts = %s, want source graph", request.ExtensionFacts)
	}
	events, err := staticIndexCutoverEvents(c.root)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
		Telemetry:       staticIndexTestTelemetry(1, 0, 1, 1),
	}, nil
}

func (c *staticIndexCutoverCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexCutoverCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	c.parseCalls++
	return nil, fmt.Errorf("ParseFile should not be called by Static Index cutover")
}

func (c *staticIndexCutoverCompiler) ParseFiles(context.Context, []frontend.Request) ([]json.RawMessage, error) {
	c.batchParseCalls++
	return nil, fmt.Errorf("ParseFiles should not be called by Static Index cutover")
}

func (c *staticIndexCutoverCompiler) ParseFilesStream(context.Context, []frontend.Request, frontend.RecordHandler) error {
	c.streamParseCalls++
	return fmt.Errorf("ParseFilesStream should not be called by Static Index cutover")
}

func (c *staticIndexCutoverCompiler) Concurrency() int { return 1 }

func (c *staticIndexCutoverCompiler) Close() error { return nil }

var _ frontend.Parser = (*staticIndexCutoverCompiler)(nil)
var _ frontend.BatchParser = (*staticIndexCutoverCompiler)(nil)
var _ frontend.StreamParser = (*staticIndexCutoverCompiler)(nil)
var _ StaticCompiler = (*staticIndexCutoverCompiler)(nil)
