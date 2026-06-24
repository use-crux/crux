package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestProjectIndexWorkerNativeStaticBuildsPlanWithoutNodeStaticPlan(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'native-static-cutover' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	configFile := filepath.Join(root, "crux.config.ts")
	if err := os.WriteFile(configFile, []byte("import { config } from '@crux/core'\nexport default config({ experimental: { indexer: { nativeAst: true } } })\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	script := filepath.Join(t.TempDir(), "native-static-config-only-indexer.mjs")
	if err := os.WriteFile(script, []byte(nativeStaticConfigOnlyIndexerScript()), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &nativeStaticConfigOnlyCompiler{root: root, sourceFile: sourceFile}
	worker := NewProjectIndexWorker(script)
	worker.WithProjectSyntaxWorker(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-static-plan")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:native-static-cutover" {
		t.Fatalf("definitions = %+v, want native static finalize result", patch.Facts.Definitions)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 || compiler.finalizeCalls != 1 {
		t.Fatalf("native static calls = prepare %d analyze %d finalize %d, want 1 each", compiler.prepareCalls, compiler.analyzeCalls, compiler.finalizeCalls)
	}
	if !compiler.sawWriter || !compiler.sawConfig {
		t.Fatalf("prepare saw writer=%v config=%v, want Go-selected source and config files", compiler.sawWriter, compiler.sawConfig)
	}
	timing := worker.LastAstTiming()
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) {
		t.Fatalf("timing.NodeReasons = %v, want no full static plan inspection", timing.NodeReasons)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonNativeStaticConfig) {
		t.Fatalf("timing.NodeReasons = %v, want simple nativeAst config parsed without Node", timing.NodeReasons)
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonNativeStaticRules) {
		t.Fatalf("timing.NodeReasons = %v, want no first-party rule worker", timing.NodeReasons)
	}
}

func TestProjectNativeStaticSimpleConfigParser(t *testing.T) {
	root := t.TempDir()
	configFile := filepath.Join(root, "crux.config.ts")

	config, ok := projectNativeStaticParseSimpleConfig(root, configFile, "export default config({ experimental: { indexer: { nativeAst: { frontend: 'oxc' } } } })")
	if !ok {
		t.Fatal("simple nativeAst object config was not parsed")
	}
	if !config.NativeAstEnabled || config.NativeAstFrontend != "oxc" || config.ConfigFile != configFile {
		t.Fatalf("config = %+v, want nativeAst oxc config", config)
	}

	config, ok = projectNativeStaticParseSimpleConfig(root, configFile, "export default config({ experimental: { indexer: { nativeAst: false } } })")
	if !ok || config.NativeAstEnabled {
		t.Fatalf("config = %+v ok=%v, want explicit nativeAst false", config, ok)
	}

	if _, ok := projectNativeStaticParseSimpleConfig(root, configFile, "export default config({ experimental: { indexer: { nativeAst: true } }, indexer: { extensions: [{ package: '@acme/ext' }] } })"); ok {
		t.Fatal("extension config should fall back to executable Node config")
	}
	if _, ok := projectNativeStaticParseSimpleConfig(root, configFile, "export default config({ experimental: { indexer: { nativeAst: true } }, lint: { profile: 'strict' } })"); ok {
		t.Fatal("lint config should fall back to executable Node config")
	}
}

func nativeStaticConfigOnlyIndexerScript() string {
	return `
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.method === 'inspectProjectStaticSyntaxPlan') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-static-plan',
					artifact: 'projectStaticSyntaxPlan',
					error: { message: 'full static plan bridge must not run' }
				}) + '\n')
				return
			}
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
			process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
		})
	`
}

type nativeStaticConfigOnlyCompiler struct {
	root          string
	sourceFile    string
	prepareCalls  int
	analyzeCalls  int
	finalizeCalls int
	sawWriter     bool
	sawConfig     bool
}

func (c *nativeStaticConfigOnlyCompiler) NativeStaticPrepare(_ context.Context, request projectNativeStaticPrepareRequest) (projectNativeStaticPrepareResponse, error) {
	c.prepareCalls++
	if request.Root != c.root {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare root = %q, want %q", request.Root, c.root)
	}
	if len(request.ExtensionHost) == 0 {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare missing static host")
	}
	if !stringSliceContains(request.CallNames, "prompt") || !stringSliceContains(request.ConstructorNames, "Agent") {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare interests missing prompt/Agent: calls=%v constructors=%v", request.CallNames, request.ConstructorNames)
	}
	for _, file := range request.Files {
		if file.File == c.sourceFile {
			c.sawWriter = true
		}
		if filepath.Base(file.File) == "crux.config.ts" {
			c.sawConfig = true
		}
	}
	if !c.sawWriter || !c.sawConfig {
		return projectNativeStaticPrepareResponse{}, fmt.Errorf("prepare files = %+v, want writer and config", request.Files)
	}
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

func (c *nativeStaticConfigOnlyCompiler) NativeStaticAnalyzeStream(_ context.Context, request projectNativeStaticAnalyzeRequest, handle projectNativeStaticAnalyzeStreamHandler) (projectNativeStaticAnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	if len(request.ExtensionEvidenceInterests) == 0 {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("analyze missing static interests")
	}
	return nativeStaticTestAnalyzeStream(projectNativeStaticAnalyzeResponse{
		ProtocolVersion:       projectNativeStaticProtocolVersion,
		Method:                projectNativeStaticAnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:native-static-cutover","kind":"prompt","name":"native-static-cutover","fidelity":"resolved","status":"active"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             nativeStaticTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *nativeStaticConfigOnlyCompiler) NativeStaticFinalize(_ context.Context, request projectNativeStaticFinalizeRequest) (projectNativeStaticFinalizeResponse, error) {
	c.finalizeCalls++
	if len(request.NativeFacts) != 1 {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize native facts = %d, want 1", len(request.NativeFacts))
	}
	if len(request.RelationSpecs) != 0 {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize relation specs came from Go plan, want Rust defaults")
	}
	if len(request.ExtensionFacts) != 1 || !bytes.Contains(request.ExtensionFacts[0], []byte("sourceGraph")) {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize extension facts = %s, want only source graph", request.ExtensionFacts)
	}
	if request.EmitBuiltinLints == nil || *request.EmitBuiltinLints {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize emitBuiltinLints = %v, want false for AST finalize", request.EmitBuiltinLints)
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

func (c *nativeStaticConfigOnlyCompiler) NativeStaticFinalizeStream(ctx context.Context, request projectNativeStaticFinalizeRequest, handle projectNativeStaticFinalizeStreamHandler) (projectNativeStaticFinalizeResponse, error) {
	if !request.Stream {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *nativeStaticConfigOnlyCompiler) ParseFile(context.Context, ProjectSyntaxParseRequest) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by native static config-only plan")
}

func (c *nativeStaticConfigOnlyCompiler) Concurrency() int { return 1 }

func (c *nativeStaticConfigOnlyCompiler) Close() error { return nil }

var _ ProjectSyntaxParser = (*nativeStaticConfigOnlyCompiler)(nil)
var _ ProjectNativeStaticCompiler = (*nativeStaticConfigOnlyCompiler)(nil)
