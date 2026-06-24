package projectindexer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorkerIndexProjectLintPatchUsesNativeQualityFinalize(t *testing.T) {
	root := "/repo"
	compiler := &nativeStaticLintCompiler{root: root}
	worker := &Worker{syntaxParser: compiler}
	worker.recordLastAstTiming(ProjectIndexAstTiming{UsedNativeStatic: true})

	patch, err := worker.IndexProjectLintPatch(context.Background(), projectindex.ProjectLintIndexRequest{
		Root:                root,
		ProjectName:         "native-static-lint",
		ASTUsedNativeStatic: true,
		PreviousIndex: store.IndexData{
			Definitions: []store.ProjectDefinition{{
				ID:       "quality-target:writer",
				Kind:     "quality.target",
				Name:     "writer",
				Fidelity: "resolved",
				Quality: &store.IndexQuality{
					ExperimentIDs:   []string{"experiment:writer"},
					ExperimentCount: 1,
				},
			}},
		},
	})
	if err != nil {
		t.Fatalf("IndexProjectLintPatch error = %v", err)
	}
	if compiler.finalizeCalls != 1 {
		t.Fatalf("finalize calls = %d, want 1", compiler.finalizeCalls)
	}
	if patch.Phase != "quality" {
		t.Fatalf("patch phase = %q, want quality", patch.Phase)
	}
	if len(patch.Facts.LintFindings) != 1 || patch.Facts.LintFindings[0].RuleID != "quality.missing_baseline" {
		t.Fatalf("lint findings = %+v, want quality.missing_baseline", patch.Facts.LintFindings)
	}
	if bytes.Contains(compiler.finalizeLintFacts, []byte(`"lintFindings"`)) {
		t.Fatalf("lint facts = %s, should not echo previous lint findings", compiler.finalizeLintFacts)
	}
}

func TestWorkerIndexProjectLintPatchSkipsTypeScriptAstRuns(t *testing.T) {
	compiler := &nativeStaticLintCompiler{root: "/repo"}
	worker := &Worker{syntaxParser: compiler}

	patch, err := worker.IndexProjectLintPatch(context.Background(), projectindex.ProjectLintIndexRequest{
		Root: "/repo",
		PreviousIndex: store.IndexData{
			Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved"}},
		},
	})
	if err != nil {
		t.Fatalf("IndexProjectLintPatch error = %v", err)
	}
	if compiler.finalizeCalls != 0 {
		t.Fatalf("finalize calls = %d, want no native lint call for TypeScript AST", compiler.finalizeCalls)
	}
	if patch.Phase != "" {
		t.Fatalf("patch = %+v, want empty patch", patch)
	}
}

func TestWorkerIndexProjectLintPatchUsesPrefetchedRuleFacts(t *testing.T) {
	compiler := &nativeStaticLintCompiler{
		root:              "/repo",
		wantExtensionFact: []byte("rule:prefetched"),
	}
	worker := &Worker{syntaxParser: compiler}
	worker.recordLastAstTiming(ProjectIndexAstTiming{UsedNativeStatic: true})

	_, err := worker.IndexProjectLintPatch(context.Background(), projectindex.ProjectLintIndexRequest{
		Root:                "/repo",
		ProjectName:         "native-static-lint",
		ASTUsedNativeStatic: true,
		PreviousIndex: store.IndexData{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
			}},
			RuleDescriptors: []store.IndexRuleDescriptor{{
				ID:       "@acme/rules/prefetched",
				Source:   "extension",
				Severity: "warning",
			}},
		},
		Prefetch: &projectindex.ProjectLintPrefetchResult{
			RuleFacts: []json.RawMessage{json.RawMessage(`{"lintFindings":[{"id":"rule:prefetched","ruleId":"@acme/rules/prefetched","severity":"warning","message":"prefetched","evidence":[]}]}`)},
		},
	})
	if err != nil {
		t.Fatalf("IndexProjectLintPatch error = %v", err)
	}
	if compiler.finalizeCalls != 1 {
		t.Fatalf("finalize calls = %d, want 1", compiler.finalizeCalls)
	}
	if !bytes.Contains(compiler.finalizeExtensionFacts, compiler.wantExtensionFact) {
		t.Fatalf("finalize extension facts = %s, want %s", compiler.finalizeExtensionFacts, compiler.wantExtensionFact)
	}
}

type nativeStaticLintCompiler struct {
	root                   string
	finalizeCalls          int
	finalizeLintFacts      json.RawMessage
	finalizeExtensionFacts json.RawMessage
	wantExtensionFact      []byte
}

func (c *nativeStaticLintCompiler) NativeStaticPrepare(context.Context, staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	return staticprotocol.PrepareResponse{}, fmt.Errorf("NativeStaticPrepare should not be called by lint finalize")
}

func (c *nativeStaticLintCompiler) NativeStaticAnalyzeStream(context.Context, staticprotocol.AnalyzeRequest, staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error) {
	return staticprotocol.AnalyzeResponse{}, fmt.Errorf("NativeStaticAnalyzeStream should not be called by lint finalize")
}

func (c *nativeStaticLintCompiler) NativeStaticFinalize(_ context.Context, request staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error) {
	c.finalizeCalls++
	if request.PatchPhase != "quality" {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("patch phase = %q, want quality", request.PatchPhase)
	}
	if request.EmitBuiltinLints == nil || !*request.EmitBuiltinLints {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("emitBuiltinLints = %v, want true", request.EmitBuiltinLints)
	}
	if len(request.NativeFacts) != 0 {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("native facts = %d, want lint-only finalize", len(request.NativeFacts))
	}
	if request.ExtensionFacts == nil {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("extension facts slice is nil, want empty JSON array")
	}
	for _, fact := range request.ExtensionFacts {
		c.finalizeExtensionFacts = append(c.finalizeExtensionFacts, fact...)
	}
	if len(c.wantExtensionFact) == 0 && len(request.ExtensionFacts) != 0 {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("extension facts = %s, want none", c.finalizeExtensionFacts)
	}
	if len(c.wantExtensionFact) > 0 && !bytes.Contains(c.finalizeExtensionFacts, c.wantExtensionFact) {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("extension facts = %s, want %s", c.finalizeExtensionFacts, c.wantExtensionFact)
	}
	for _, fact := range request.LintFacts {
		c.finalizeLintFacts = append(c.finalizeLintFacts, fact...)
	}
	if !bytes.Contains(c.finalizeLintFacts, []byte(`"definitions"`)) {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("lint facts = %s, want definitions", c.finalizeLintFacts)
	}
	events, err := nativeStaticLintPatchEvents(c.root)
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return staticprotocol.FinalizeResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.FinalizeMethod,
		Events:          events,
		Telemetry:       nativeStaticTestTelemetry(0, 0, 0, 0),
	}, nil
}

func (c *nativeStaticLintCompiler) NativeStaticFinalizeStream(ctx context.Context, request staticprotocol.FinalizeRequest, handle staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error) {
	if !request.Stream {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *nativeStaticLintCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by lint finalize")
}

func (c *nativeStaticLintCompiler) Concurrency() int { return 1 }

func (c *nativeStaticLintCompiler) Close() error { return nil }

var _ syntax.Parser = (*nativeStaticLintCompiler)(nil)
var _ StaticCompiler = (*nativeStaticLintCompiler)(nil)

func nativeStaticLintPatchEvents(root string) ([]json.RawMessage, error) {
	tx := "tx-native-static-lint"
	values := []any{
		map[string]any{"protocolVersion": 2, "type": "phase:start", "transactionId": tx, "phase": "quality", "root": root, "startedAt": "1970-01-01T00:00:00.000Z"},
		map[string]any{
			"protocolVersion": 2,
			"type":            "fact:batch",
			"transactionId":   tx,
			"sequence":        0,
			"facts": []any{
				map[string]any{
					"schemaVersion": 1,
					"factId":        "lintFindings:lint:quality.missing_baseline:quality-target:writer",
					"kind":          "lintFindings",
					"phase":         "quality",
					"projectRoot":   root,
					"producer":      map[string]any{"name": workerProducer, "version": "test"},
					"fidelity":      "inferred",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.quality"},
					"fact": map[string]any{
						"id":         "lint:quality.missing_baseline:quality-target:writer",
						"ruleId":     "quality.missing_baseline",
						"severity":   "info",
						"category":   "quality",
						"maturity":   "preview",
						"confidence": "high",
						"profiles":   []any{"recommended", "strict"},
						"title":      "Quality target has no baseline",
						"message":    "writer has experiment history but no promoted baseline.",
						"rationale":  "A promoted baseline lets you compare future runs against known behavior.",
						"evidence":   []any{},
						"fixes":      []any{},
					},
				},
			},
		},
		map[string]any{
			"protocolVersion": 2,
			"type":            "phase:done",
			"transactionId":   tx,
			"phase":           "quality",
			"patch":           map[string]any{"schemaVersion": 1, "phase": "quality", "project": map[string]any{"root": root, "name": "native-static-lint"}, "startedAt": "1970-01-01T00:00:00.000Z", "finishedAt": "1970-01-01T00:00:00.000Z", "status": "ok"},
			"summary":         map[string]any{"factCount": 1, "decision": map[string]any{"nativeStaticComplete": true}},
		},
	}
	events := make([]json.RawMessage, 0, len(values))
	for _, value := range values {
		data, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		events = append(events, data)
	}
	return events, nil
}
