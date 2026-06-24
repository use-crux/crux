package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func TestProjectStaticPlanNativeStaticSchedulableRejectsCompatibilityEvidence(t *testing.T) {
	plan := devtools.ProjectStaticSyntaxPlan{
		StaticHost: json.RawMessage(`{"nativeOnlyEligible":false,"requiresTypeScriptHostForExtensions":true,"requiresCompatibilityEvidence":true}`),
	}
	if projectStaticPlanNativeStaticSchedulable(plan) {
		t.Fatalf("projectStaticPlanNativeStaticSchedulable = true, want false for compatibility evidence")
	}
}

func TestProjectIndexWorkerNativeStaticSchedulesExtensionEvidenceJobs(t *testing.T) {
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

func runNativeStaticGuardFallback(t *testing.T, extensionEvidenceJobs bool) (devtools.IndexPatch, *nativeStaticGuardCompiler, error) {
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
	worker := NewProjectIndexWorker(script)
	worker.WithProjectSyntaxWorker(compiler)
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

func (c *nativeStaticGuardCompiler) NativeStaticPrepare(_ context.Context, request projectNativeStaticPrepareRequest) (projectNativeStaticPrepareResponse, error) {
	c.prepareCalls++
	return projectNativeStaticPrepareResponse{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticPrepareMethod,
		Plan: projectNativeStaticPlan{
			Root:        request.Root,
			ProjectName: request.ProjectName,
			Files:       append([]projectNativeStaticSourceFile(nil), request.Files...),
			CacheMisses: append([]projectNativeStaticSourceFile(nil), request.Files...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   nativeStaticTestTelemetry(len(request.Files), 0, len(request.Files), 0),
	}, nil
}

func (c *nativeStaticGuardCompiler) NativeStaticAnalyzeStream(_ context.Context, request projectNativeStaticAnalyzeRequest, handle projectNativeStaticAnalyzeStreamHandler) (projectNativeStaticAnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	jobs := []json.RawMessage{}
	if c.extensionEvidenceJobs {
		jobs = append(jobs, json.RawMessage(`{"id":"extension-job","extractor":{"extension":"third-party","name":"custom"}}`))
	}
	return nativeStaticTestAnalyzeStream(projectNativeStaticAnalyzeResponse{
		ProtocolVersion:       projectNativeStaticProtocolVersion,
		Method:                projectNativeStaticAnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:native-with-extension-job"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: jobs,
		Telemetry:             nativeStaticTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *nativeStaticGuardCompiler) NativeStaticFinalize(_ context.Context, request projectNativeStaticFinalizeRequest) (projectNativeStaticFinalizeResponse, error) {
	c.finalizeCalls++
	for _, fact := range request.ExtensionFacts {
		c.finalizeExtensionFacts = append(c.finalizeExtensionFacts, fact...)
	}
	if c.extensionEvidenceJobs && !bytes.Contains(c.finalizeExtensionFacts, []byte("prompt:extension-host")) {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize missing extension host facts: %s", c.finalizeExtensionFacts)
	}
	events, err := nativeStaticGuardEvents(c.root)
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

func (c *nativeStaticGuardCompiler) NativeStaticFinalizeStream(ctx context.Context, request projectNativeStaticFinalizeRequest, handle projectNativeStaticFinalizeStreamHandler) (projectNativeStaticFinalizeResponse, error) {
	if !request.Stream {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *nativeStaticGuardCompiler) ParseFile(context.Context, ProjectSyntaxParseRequest) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by guard fallback")
}

func (c *nativeStaticGuardCompiler) ParseFilesStream(_ context.Context, requests []ProjectSyntaxParseRequest, handle ProjectSyntaxRecordHandler) error {
	c.streamParseCalls++
	if len(requests) != 1 || requests[0].File != c.sourceFile {
		return fmt.Errorf("stream requests = %+v, want %s", requests, c.sourceFile)
	}
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"oxc-rust","version":"test"},"file":%q,"sourceHash":"guard-fallback-hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, c.sourceFile))
	return handle(0, record)
}

func (c *nativeStaticGuardCompiler) Concurrency() int { return 1 }

func (c *nativeStaticGuardCompiler) Close() error { return nil }

var _ ProjectSyntaxParser = (*nativeStaticGuardCompiler)(nil)
var _ ProjectSyntaxBatchStreamParser = (*nativeStaticGuardCompiler)(nil)
var _ ProjectNativeStaticCompiler = (*nativeStaticGuardCompiler)(nil)
