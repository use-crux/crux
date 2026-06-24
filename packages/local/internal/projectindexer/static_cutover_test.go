package projectindexer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestWorkerNativeStaticCutoverUsesFinalizePatchEvents(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	sourceFile := filepath.Join(srcDir, "writer.ts")
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'native-static-cutover' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	writeNativeStaticEnabledConfig(t, root)

	dir := t.TempDir()
	script := filepath.Join(dir, "native-static-cutover-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
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
			if (req.method === 'indexProjectAstFromSyntaxRecords' || req.method === 'indexProjectAst') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'native static cutover should not call ' + req.method }
				}) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &nativeStaticCutoverCompiler{root: root, sourceFile: sourceFile}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-static-cutover")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:native-static-cutover" {
		t.Fatalf("definitions = %+v, want native static finalize result", patch.Facts.Definitions)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 || compiler.finalizeCalls != 1 {
		t.Fatalf("native static calls = prepare %d analyze %d finalize %d, want 1 each", compiler.prepareCalls, compiler.analyzeCalls, compiler.finalizeCalls)
	}
	if compiler.finalizeStreams != 1 {
		t.Fatalf("finalize stream calls = %d, want 1", compiler.finalizeStreams)
	}
	if compiler.parseCalls != 0 || compiler.batchParseCalls != 0 || compiler.streamParseCalls != 0 {
		t.Fatalf("syntax-record parsing was called: parse=%d batch=%d stream=%d", compiler.parseCalls, compiler.batchParseCalls, compiler.streamParseCalls)
	}
	if !nativeStaticAnalyzeFilesContain(compiler.analyzeFiles, sourceFile) {
		t.Fatalf("analyze files = %+v, want selected source %s", compiler.analyzeFiles, sourceFile)
	}

	timing := worker.LastAstTiming()
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonNativeStaticConfig) {
		t.Fatalf("timing.NodeReasons = %v, want no %q for simple native config", timing.NodeReasons, projectIndexNodeReasonNativeStaticConfig)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) {
		t.Fatalf("timing.NodeReasons = %v, want no %q", timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonSyntaxRecordProjection) {
		t.Fatalf("timing.NodeReasons = %v, want no %q", timing.NodeReasons, projectIndexNodeReasonSyntaxRecordProjection)
	}
	if !reflect.DeepEqual(timing.NativeOnlyReasons, timing.NodeReasons) {
		t.Fatalf("timing.NativeOnlyReasons = %v, want NodeReasons %v", timing.NativeOnlyReasons, timing.NodeReasons)
	}
	if timing.NodeStarted || !timing.NativeOnlyEligible {
		t.Fatalf("timing = %+v, want node-free native-only-eligible indexing", timing)
	}
}

type nativeStaticCutoverCompiler struct {
	root             string
	sourceFile       string
	prepareCalls     int
	analyzeCalls     int
	finalizeCalls    int
	finalizeStreams  int
	parseCalls       int
	batchParseCalls  int
	streamParseCalls int
	analyzeFiles     []projectNativeStaticAnalyzeFile
}

func (c *nativeStaticCutoverCompiler) NativeStaticPrepare(_ context.Context, request projectNativeStaticPrepareRequest) (projectNativeStaticPrepareResponse, error) {
	c.prepareCalls++
	if request.Root != c.root {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare root = %q, want %q", request.Root, c.root)
	}
	if !stringSliceContains(request.CallNames, "prompt") {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare call names = %v, want prompt", request.CallNames)
	}
	if !stringSliceContains(request.ConstructorNames, "Agent") {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare constructor names = %v, want Agent", request.ConstructorNames)
	}
	if !nativeStaticPrepareFilesContain(request.Files, c.sourceFile) {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare files = %+v, want hashed source file", request.Files)
	}
	if len(request.ExtensionHost) == 0 {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare missing static host")
	}
	return projectNativeStaticPrepareResponse{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticPrepareMethod,
		Plan: projectNativeStaticPlan{
			Root:                     request.Root,
			ProjectName:              request.ProjectName,
			Files:                    append([]projectNativeStaticSourceFile(nil), request.Files...),
			CacheHits:                []projectNativeStaticSourceFile{},
			CacheMisses:              append([]projectNativeStaticSourceFile(nil), request.Files...),
			CallNames:                append([]string(nil), request.CallNames...),
			CallInterests:            append([]syntax.CallInterest(nil), request.CallInterests...),
			ConstructorNames:         append([]string(nil), request.ConstructorNames...),
			ConstructorInterests:     append([]syntax.ConstructorInterest(nil), request.ConstructorInterests...),
			PruneNativeFactCallNames: append([]string(nil), request.PruneNativeFactCallNames...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   nativeStaticTestTelemetry(1, 0, 1, 0),
	}, nil
}

func (c *nativeStaticCutoverCompiler) NativeStaticAnalyzeStream(_ context.Context, request projectNativeStaticAnalyzeRequest, handle projectNativeStaticAnalyzeStreamHandler) (projectNativeStaticAnalyzeResponse, error) {
	c.analyzeCalls++
	c.analyzeFiles = append([]projectNativeStaticAnalyzeFile(nil), request.Files...)
	if !request.Stream {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	if len(request.ExtensionEvidenceInterests) == 0 {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("analyze missing static interests")
	}
	if !stringSliceContains(request.Plan.CallNames, "prompt") {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("analyze plan call names = %v, want prompt", request.Plan.CallNames)
	}
	if !nativeStaticAnalyzeFilesContain(request.Files, c.sourceFile) {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("analyze files = %+v, want selected file", request.Files)
	}
	return nativeStaticTestAnalyzeStream(projectNativeStaticAnalyzeResponse{
		ProtocolVersion:       projectNativeStaticProtocolVersion,
		Method:                projectNativeStaticAnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","id":"prompt:native-static-cutover"}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             nativeStaticTestTelemetry(1, 0, 1, len(request.Files)),
	}, handle)
}

func (c *nativeStaticCutoverCompiler) NativeStaticFinalize(_ context.Context, request projectNativeStaticFinalizeRequest) (projectNativeStaticFinalizeResponse, error) {
	c.finalizeCalls++
	if request.Stream {
		c.finalizeStreams++
	}
	if len(request.NativeFacts) != 1 {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize native facts = %d, want 1", len(request.NativeFacts))
	}
	if len(request.RelationSpecs) != 0 {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize relation specs = %s, want Rust defaults", request.RelationSpecs)
	}
	if len(request.ExtensionFacts) != 1 ||
		!bytes.Contains(request.ExtensionFacts[0], []byte("sourceGraph")) {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize extension facts = %s, want source graph", request.ExtensionFacts)
	}
	events, err := nativeStaticCutoverEvents(c.root)
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	return projectNativeStaticFinalizeResponse{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticFinalizeMethod,
		Events:          events,
		Telemetry:       nativeStaticTestTelemetry(1, 0, 1, 1),
	}, nil
}

func (c *nativeStaticCutoverCompiler) NativeStaticFinalizeStream(ctx context.Context, request projectNativeStaticFinalizeRequest, handle projectNativeStaticFinalizeStreamHandler) (projectNativeStaticFinalizeResponse, error) {
	if !request.Stream {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *nativeStaticCutoverCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	c.parseCalls++
	return nil, fmt.Errorf("ParseFile should not be called by native static cutover")
}

func (c *nativeStaticCutoverCompiler) ParseFiles(context.Context, []syntax.Request) ([]json.RawMessage, error) {
	c.batchParseCalls++
	return nil, fmt.Errorf("ParseFiles should not be called by native static cutover")
}

func (c *nativeStaticCutoverCompiler) ParseFilesStream(context.Context, []syntax.Request, syntax.RecordHandler) error {
	c.streamParseCalls++
	return fmt.Errorf("ParseFilesStream should not be called by native static cutover")
}

func (c *nativeStaticCutoverCompiler) Concurrency() int { return 1 }

func (c *nativeStaticCutoverCompiler) Close() error { return nil }

var _ syntax.Parser = (*nativeStaticCutoverCompiler)(nil)
var _ syntax.BatchParser = (*nativeStaticCutoverCompiler)(nil)
var _ syntax.StreamParser = (*nativeStaticCutoverCompiler)(nil)
var _ StaticCompiler = (*nativeStaticCutoverCompiler)(nil)
