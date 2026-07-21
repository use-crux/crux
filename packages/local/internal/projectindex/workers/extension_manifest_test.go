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

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestWorkerStaticIndexLoadsConfiguredExtensionManifestWithoutNodeStaticPlan(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "workflow.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const workflow = defineWorkflow({ id: 'publish' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	configFile := filepath.Join(root, "crux.config.ts")
	if err := os.WriteFile(configFile, []byte("import { config } from '@use-crux/core'\nexport default config({ indexer: { extensions: [{ package: '@acme/crux-indexer-extension' }] } })\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cacheKey := "static-cache-key:workflow-extension"
	writeStaticIndexPlanCacheFile(t, root, cacheKey)
	writeStaticIndexPlanCacheManifest(t, root, map[string]any{
		"version":        cache.Epoch,
		"root":           root,
		"file":           "src/workflow.ts",
		"sourceHash":     staticIndexPlanCacheFixtureHash(t, sourceFile),
		"dependencies":   []map[string]string{},
		"configFiles":    []map[string]string{},
		"compilerInputs": staticIndexPlanCacheCompilerInputsWithExtensionFixture(t),
		"cacheKey":       cacheKey,
	})

	script := filepath.Join(t.TempDir(), "static-index-extension-manifest-indexer.mjs")
	if err := os.WriteFile(script, []byte(staticIndexExtensionManifestIndexerScript(
		staticIndexPlanCacheCompilerInputsWithExtensionFixtureJSON(t),
	)), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &staticIndexExtensionManifestCompiler{root: root, sourceFile: sourceFile}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index-extension-manifest")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:static-index-cutover" {
		t.Fatalf("definitions = %+v, want Static Index finalize result", patch.Facts.Definitions)
	}
	if !compiler.sawFirstPartyCall || !compiler.sawExtensionCall {
		t.Fatalf("prepare saw prompt=%v defineWorkflow=%v, want merged first-party and extension call names", compiler.sawFirstPartyCall, compiler.sawExtensionCall)
	}
	if !compiler.sawExtensionInterest || !compiler.sawExtensionHost || !compiler.sawExtensionRelation || !compiler.sawExtensionRuleDescriptor {
		t.Fatalf("extension manifest fields: interest=%v host=%v relation=%v ruleDescriptor=%v, want all forwarded", compiler.sawExtensionInterest, compiler.sawExtensionHost, compiler.sawExtensionRelation, compiler.sawExtensionRuleDescriptor)
	}
	if !compiler.sawSourceCacheHit {
		t.Fatalf("prepare did not see warm extension cache hit for %s", sourceFile)
	}
	timing := worker.LastAstTiming()
	for _, reason := range []string{
		projectIndexNodeReasonStaticIndexConfig,
		projectIndexNodeReasonStaticIndexExtensions,
	} {
		if !containsTimingReason(timing.NodeReasons, reason) {
			t.Fatalf("timing.NodeReasons = %v, want %q", timing.NodeReasons, reason)
		}
	}
	if containsTimingReason(timing.NodeReasons, projectIndexNodeReasonStaticPlanInspection) {
		t.Fatalf("timing.NodeReasons = %v, want no full static plan inspection", timing.NodeReasons)
	}
	if containsPhaseTiming(timing.NodeTimings, planner.TimingExtensionFileSelection) {
		t.Fatalf("timing.NodeTimings = %+v, want extension manifest call names folded into initial file selection", timing.NodeTimings)
	}
}

func staticIndexExtensionManifestIndexerScript(cacheInputs string) string {
	return fmt.Sprintf(`
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
						extensions: [{ package: '@acme/crux-indexer-extension' }],
						diagnostics: []
					}
				}) + '\n')
				return
			}
			if (req.method === 'loadStaticExtensionHostManifest') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 3,
					type: 'artifact:done',
					transactionId: 'artifact-static-extension-host-manifest',
					artifact: 'staticExtensionHostManifest',
					root: req.root,
					payload: {
						method: 'loadStaticExtensionHostManifest',
						root: req.root,
						nativeCompilerProtocolVersion: req.nativeCompilerProtocolVersion,
						manifest: {
							callNames: ['defineWorkflow'],
							staticInterests: {
								calls: [{ name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 0, source: 'extractor-pattern' }],
								compatibility: { mode: 'declared' }
							},
								staticHost: {
								extractors: [{ extension: { name: '@acme/workflows', version: '1' }, name: 'workflow.define', mode: 'typescript-extension' }],
								bundledNativeExtractorCount: 0,
								extensionTypeScriptExtractorCount: 1,
								typeScriptRuleCount: 1,
								requiresTypeScriptHostForExtensions: true,
								requiresTypeScriptHostForRules: true,
								requiresCompatibilityEvidence: false,
								nativeOnlyEligible: false
							},
							relationSpecs: [{ type: '@acme/workflow/uses_tool', fromKinds: ['@acme/workflow'], toKinds: ['tool'], presentation: 'edge', fidelity: 'partial' }],
							cacheInputs: [{ kind: 'extension', name: '@acme/workflows', version: '1' }]
						},
						cacheInputs: %s,
						ruleDescriptors: [{ id: '@acme/rules/require-owner', source: 'extension', title: 'Require owner', description: 'Require owner', severity: 'warning', phase: 'index', requires: ['definitions'], fidelity: 'safe', messageIds: [] }],
						diagnostics: [],
						node: { started: true, reasons: ['typescript-extension-extractors', 'typescript-rules'] },
						nativeOnlyEligible: false,
						nativeOnlyReasons: ['typescript-extension-extractors', 'typescript-rules']
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
	`, cacheInputs)
}

type staticIndexExtensionManifestCompiler struct {
	root                       string
	sourceFile                 string
	sawFirstPartyCall          bool
	sawExtensionCall           bool
	sawExtensionInterest       bool
	sawExtensionHost           bool
	sawExtensionRelation       bool
	sawExtensionRuleDescriptor bool
	sawSourceCacheHit          bool
}

func (c *staticIndexExtensionManifestCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	c.sawFirstPartyCall = stringSliceContains(request.CallNames, "prompt")
	c.sawExtensionCall = stringSliceContains(request.CallNames, "defineWorkflow")
	c.sawExtensionHost = bytes.Contains(request.ExtensionHost, []byte(`"extensionTypeScriptExtractorCount":1`))
	if !c.sawFirstPartyCall || !c.sawExtensionCall || !c.sawExtensionHost {
		return protocol.PrepareResponse{}, fmt.Errorf("prepare missing extension manifest fields: calls=%v host=%s", request.CallNames, request.ExtensionHost)
	}
	hits := []protocol.SourceFile{}
	misses := []protocol.SourceFile{}
	for _, file := range request.PrimaryFiles {
		if file.File == c.sourceFile && file.CacheKey != "" {
			c.sawSourceCacheHit = true
		}
		if file.CacheKey != "" {
			hits = append(hits, file)
		} else {
			misses = append(misses, file)
		}
	}
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:        request.Root,
			ProjectName: request.ProjectName,
			Files:       append([]protocol.SourceFile(nil), request.Files...),
			CacheHits:   hits,
			CacheMisses: misses,
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   staticIndexTestTelemetry(len(request.Files), len(hits), len(misses), 0),
	}, nil
}

func (c *staticIndexExtensionManifestCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	c.sawExtensionInterest = bytes.Contains(request.ExtensionEvidenceInterests, []byte("defineWorkflow"))
	if !c.sawExtensionInterest {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze interests = %s, want defineWorkflow", request.ExtensionEvidenceInterests)
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

func (c *staticIndexExtensionManifestCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.sawExtensionRelation = bytes.Contains(request.RelationSpecs, []byte("@acme/workflow/uses_tool"))
	for _, fact := range request.ExtensionFacts {
		if bytes.Contains(fact, []byte("@acme/rules/require-owner")) {
			c.sawExtensionRuleDescriptor = true
		}
	}
	if !c.sawExtensionRelation || !c.sawExtensionRuleDescriptor {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize relationSpecs=%s extensionFacts=%s, want extension metadata", request.RelationSpecs, request.ExtensionFacts)
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

func (c *staticIndexExtensionManifestCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexExtensionManifestCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by extension manifest test")
}

func (c *staticIndexExtensionManifestCompiler) Concurrency() int { return 1 }

func (c *staticIndexExtensionManifestCompiler) Close() error { return nil }

var _ frontend.Parser = (*staticIndexExtensionManifestCompiler)(nil)
var _ StaticCompiler = (*staticIndexExtensionManifestCompiler)(nil)

func containsPhaseTiming(timings []projectindex.ProjectIndexPhaseTiming, name string) bool {
	for _, timing := range timings {
		if timing.Name == name {
			return true
		}
	}
	return false
}
