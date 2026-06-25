package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

func TestProjectStaticPlanNativeStaticSchedulableRejectsCompatibilityEvidence(t *testing.T) {
	plan := projectindex.ProjectStaticSyntaxPlan{
		StaticHost: json.RawMessage(`{"nativeOnlyEligible":false,"requiresTypeScriptHostForExtensions":true,"requiresCompatibilityEvidence":true}`),
	}
	if compat.Schedulable(plan) {
		t.Fatalf("compat.Schedulable = true, want false for compatibility evidence")
	}
}

func TestWorkerNativeStaticSchedulesExtensionEvidenceJobs(t *testing.T) {
	patch, compiler, err := runNativeStaticGuardFallback(t, true)
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}

	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:extension-host" {
		t.Fatalf("definitions = %+v, want extension host facts finalized natively", patch.Facts.Definitions)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 {
		t.Fatalf("native static calls = prepare %d analyze %d, want prepare/analyze attempt", compiler.prepareCalls, compiler.analyzeCalls)
	}
	if compiler.finalizeCalls != 1 {
		t.Fatalf("finalize calls = %d, want native finalize after extension facts are available", compiler.finalizeCalls)
	}
	if compiler.streamParseCalls != 0 {
		t.Fatalf("stream parse calls = %d, want no syntax-record fallback", compiler.streamParseCalls)
	}
	if !bytes.Contains(compiler.finalizeExtensionFacts, []byte("prompt:extension-host")) {
		t.Fatalf("finalize extension facts = %s, want TypeScript host facts", compiler.finalizeExtensionFacts)
	}
}

func runNativeStaticGuardFallback(t *testing.T, extensionEvidenceJobs bool) (projectindex.IndexPatch, *nativeStaticGuardCompiler, error) {
	t.Helper()
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'guard' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	writeNativeStaticEnabledConfig(t, root)

	script := filepath.Join(t.TempDir(), "native-static-guard-indexer.mjs")
	if err := os.WriteFile(script, []byte(nativeStaticGuardIndexerScript()), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &nativeStaticGuardCompiler{root: root, sourceFile: sourceFile, extensionEvidenceJobs: extensionEvidenceJobs}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-static-guard")
	return patch, compiler, err
}

type nativeStaticGuardCompiler struct {
	root                   string
	sourceFile             string
	extensionEvidenceJobs  bool
	prepareCalls           int
	analyzeCalls           int
	finalizeCalls          int
	streamParseCalls       int
	finalizeExtensionFacts json.RawMessage
}

func (c *nativeStaticGuardCompiler) NativeStaticPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
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
		Telemetry:   nativeStaticTestTelemetry(len(request.Files), 0, len(request.Files), 0),
	}, nil
}

func (c *nativeStaticGuardCompiler) NativeStaticAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	jobs := []json.RawMessage{}
	if c.extensionEvidenceJobs {
		jobs = append(jobs, json.RawMessage(`{"id":"extension-job","extractor":{"extension":"third-party","name":"custom"}}`))
	}
	return nativeStaticTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:native-with-extension-job"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: jobs,
		Telemetry:             nativeStaticTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *nativeStaticGuardCompiler) NativeStaticFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	for _, fact := range request.ExtensionFacts {
		c.finalizeExtensionFacts = append(c.finalizeExtensionFacts, fact...)
	}
	if c.extensionEvidenceJobs && !bytes.Contains(c.finalizeExtensionFacts, []byte("prompt:extension-host")) {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize missing extension host facts: %s", c.finalizeExtensionFacts)
	}
	events, err := nativeStaticGuardEvents(c.root)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
		Telemetry:       nativeStaticTestTelemetry(1, 0, 1, 1),
	}, nil
}

func (c *nativeStaticGuardCompiler) NativeStaticFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *nativeStaticGuardCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by guard fallback")
}

func (c *nativeStaticGuardCompiler) ParseFilesStream(_ context.Context, requests []syntax.Request, handle syntax.RecordHandler) error {
	c.streamParseCalls++
	if len(requests) != 1 || requests[0].File != c.sourceFile {
		return fmt.Errorf("stream requests = %+v, want %s", requests, c.sourceFile)
	}
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":%q,"sourceHash":"guard-fallback-hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, c.sourceFile))
	return handle(0, record)
}

func (c *nativeStaticGuardCompiler) Concurrency() int { return 1 }

func (c *nativeStaticGuardCompiler) Close() error { return nil }

var _ syntax.Parser = (*nativeStaticGuardCompiler)(nil)
var _ syntax.StreamParser = (*nativeStaticGuardCompiler)(nil)
var _ StaticCompiler = (*nativeStaticGuardCompiler)(nil)
