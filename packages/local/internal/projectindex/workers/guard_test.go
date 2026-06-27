package workers

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

func TestProjectStaticPlanStaticIndexSchedulableRejectsCompatibilityEvidence(t *testing.T) {
	plan := projectindex.ProjectStaticSyntaxPlan{
		StaticHost: json.RawMessage(`{"nativeOnlyEligible":false,"requiresTypeScriptHostForExtensions":true,"requiresCompatibilityEvidence":true}`),
	}
	if compat.Schedulable(plan) {
		t.Fatalf("compat.Schedulable = true, want false for compatibility evidence")
	}
}

func TestWorkerStaticIndexSchedulesExtensionEvidenceJobs(t *testing.T) {
	patch, compiler, err := runStaticIndexGuardFallback(t, true)
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}

	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:extension-host" {
		t.Fatalf("definitions = %+v, want extension host facts finalized natively", patch.Facts.Definitions)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 {
		t.Fatalf("Static Index calls = prepare %d analyze %d, want prepare/analyze attempt", compiler.prepareCalls, compiler.analyzeCalls)
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

func runStaticIndexGuardFallback(t *testing.T, extensionEvidenceJobs bool) (projectindex.IndexPatch, *staticIndexGuardCompiler, error) {
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
	writeStaticIndexEnabledConfig(t, root)

	script := filepath.Join(t.TempDir(), "static-index-guard-indexer.mjs")
	if err := os.WriteFile(script, []byte(staticIndexGuardIndexerScript()), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &staticIndexGuardCompiler{root: root, sourceFile: sourceFile, extensionEvidenceJobs: extensionEvidenceJobs}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index-guard")
	return patch, compiler, err
}

type staticIndexGuardCompiler struct {
	root                   string
	sourceFile             string
	extensionEvidenceJobs  bool
	prepareCalls           int
	analyzeCalls           int
	finalizeCalls          int
	streamParseCalls       int
	finalizeExtensionFacts json.RawMessage
}

func (c *staticIndexGuardCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
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

func (c *staticIndexGuardCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	jobs := []json.RawMessage{}
	if c.extensionEvidenceJobs {
		jobs = append(jobs, json.RawMessage(`{"id":"extension-job","extractor":{"extension":"third-party","name":"custom"}}`))
	}
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:native-with-extension-job"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: jobs,
		Telemetry:             staticIndexTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *staticIndexGuardCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	for _, fact := range request.ExtensionFacts {
		c.finalizeExtensionFacts = append(c.finalizeExtensionFacts, fact...)
	}
	if c.extensionEvidenceJobs && !bytes.Contains(c.finalizeExtensionFacts, []byte("prompt:extension-host")) {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize missing extension host facts: %s", c.finalizeExtensionFacts)
	}
	events, err := staticIndexGuardEvents(c.root)
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

func (c *staticIndexGuardCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexGuardCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by guard fallback")
}

func (c *staticIndexGuardCompiler) ParseFilesStream(_ context.Context, requests []syntax.Request, handle syntax.RecordHandler) error {
	c.streamParseCalls++
	if len(requests) != 1 || requests[0].File != c.sourceFile {
		return fmt.Errorf("stream requests = %+v, want %s", requests, c.sourceFile)
	}
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":%q,"sourceHash":"guard-fallback-hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, c.sourceFile))
	return handle(0, record)
}

func (c *staticIndexGuardCompiler) Concurrency() int { return 1 }

func (c *staticIndexGuardCompiler) Close() error { return nil }

var _ syntax.Parser = (*staticIndexGuardCompiler)(nil)
var _ syntax.StreamParser = (*staticIndexGuardCompiler)(nil)
var _ StaticCompiler = (*staticIndexGuardCompiler)(nil)
