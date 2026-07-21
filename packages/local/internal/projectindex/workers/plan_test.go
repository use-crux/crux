package workers

import (
	"bytes"
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

func TestWorkerStaticIndexBuildsPlanWithoutNodeStaticPlan(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'static-index-cutover' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	configFile := filepath.Join(root, "crux.config.ts")
	if err := os.WriteFile(configFile, []byte("import { config } from '@use-crux/core'\nexport default config({})\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	script := filepath.Join(t.TempDir(), "static-index-config-only-indexer.mjs")
	if err := os.WriteFile(script, []byte(staticIndexConfigOnlyIndexerScript()), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &staticIndexConfigOnlyCompiler{root: root, sourceFile: sourceFile, requireConfig: true}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index-plan")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:static-index-cutover" {
		t.Fatalf("definitions = %+v, want Static Index finalize result", patch.Facts.Definitions)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 || compiler.finalizeCalls != 1 {
		t.Fatalf("Static Index calls = prepare %d analyze %d finalize %d, want 1 each", compiler.prepareCalls, compiler.analyzeCalls, compiler.finalizeCalls)
	}
	if !compiler.sawWriter || !compiler.sawConfig {
		t.Fatalf("prepare saw writer=%v config=%v, want Go-selected source and config files", compiler.sawWriter, compiler.sawConfig)
	}
	timing := worker.LastAstTiming()
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) {
		t.Fatalf("timing.NodeReasons = %v, want no full static plan inspection", timing.NodeReasons)
	}
	if !containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticIndexConfig) {
		t.Fatalf("timing.NodeReasons = %v, want executable config inspection", timing.NodeReasons)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticIndexRules) {
		t.Fatalf("timing.NodeReasons = %v, want no first-party rule worker", timing.NodeReasons)
	}
}

func TestWorkerStaticIndexDefaultsToDiscoveredCompiler(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'static-index-default' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	compiler := &staticIndexConfigOnlyCompiler{root: root, sourceFile: sourceFile}
	worker := newTestWorker(t)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index-default")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 {
		t.Fatalf("definitions = %+v, want Static Index facts from discovered compiler", patch.Facts.Definitions)
	}
}

func TestWorkerStaticIndexDefaultFailsWhenCompilerIsUnavailable(t *testing.T) {
	worker := newTestWorker(t)
	worker.WithSyntaxParser(nil)
	defer worker.Close()

	_, err := worker.IndexProjectAstPatch(context.Background(), t.TempDir(), "", "static-index-default-missing")
	if err == nil {
		t.Fatal("IndexProjectAstPatch error = nil, want missing Static Index compiler diagnostic")
	}
	if !strings.Contains(err.Error(), "requires a Static Index compiler") {
		t.Fatalf("IndexProjectAstPatch error = %v, want actionable missing Static Index compiler diagnostic", err)
	}
}

func staticIndexConfigOnlyIndexerScript() string {
	return `
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.method === 'inspectProjectStaticSyntaxPlan') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 3,
					type: 'artifact:error',
					transactionId: 'artifact-static-plan',
					artifact: 'projectStaticSyntaxPlan',
					error: { message: 'full static plan bridge must not run' }
				}) + '\n')
				return
			}
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
	`
}

type staticIndexConfigOnlyCompiler struct {
	root          string
	sourceFile    string
	prepareCalls  int
	analyzeCalls  int
	finalizeCalls int
	sawWriter     bool
	sawConfig     bool
	requireConfig bool
}

func (c *staticIndexConfigOnlyCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	c.prepareCalls++
	if request.Root != c.root {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare root = %q, want %q", request.Root, c.root)
	}
	if len(request.ExtensionHost) == 0 {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare missing static host")
	}
	if !stringSliceContains(request.CallNames, "prompt") || !stringSliceContains(request.ConstructorNames, "Agent") {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare interests missing prompt/Agent: calls=%v constructors=%v", request.CallNames, request.ConstructorNames)
	}
	for _, file := range request.Files {
		if file.File == c.sourceFile {
			c.sawWriter = true
		}
		if filepath.Base(file.File) == "crux.config.ts" {
			c.sawConfig = true
		}
	}
	if !c.sawWriter || (c.requireConfig && !c.sawConfig) {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare files = %+v, want writer and config", request.Files)
	}
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

func (c *staticIndexConfigOnlyCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	if len(request.ExtensionEvidenceInterests) == 0 {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze missing static interests")
	}
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:static-index-cutover","kind":"prompt","name":"static-index-cutover","fidelity":"resolved","status":"active"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             staticIndexTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *staticIndexConfigOnlyCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	if len(request.NativeFacts) != 1 {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize native facts = %d, want 1", len(request.NativeFacts))
	}
	if len(request.RelationSpecs) != 0 {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize relation specs came from Go plan, want Rust defaults")
	}
	if len(request.ExtensionFacts) != 1 || !bytes.Contains(request.ExtensionFacts[0], []byte("sourceGraph")) {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize extension facts = %s, want only source graph", request.ExtensionFacts)
	}
	if request.EmitBuiltinLints == nil || *request.EmitBuiltinLints {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize emitBuiltinLints = %v, want false for AST finalize", request.EmitBuiltinLints)
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

func (c *staticIndexConfigOnlyCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexConfigOnlyCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by Static Index config-only plan")
}

func (c *staticIndexConfigOnlyCompiler) Concurrency() int { return 1 }

func (c *staticIndexConfigOnlyCompiler) Close() error { return nil }

var _ frontend.Parser = (*staticIndexConfigOnlyCompiler)(nil)
var _ StaticCompiler = (*staticIndexConfigOnlyCompiler)(nil)
