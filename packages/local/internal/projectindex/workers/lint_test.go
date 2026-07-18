package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorkerIndexProjectLintPatchUsesNativeLintFinalize(t *testing.T) {
	root := "/repo"
	compiler := &staticIndexLintCompiler{root: root}
	worker := &Bundle{syntaxParser: compiler}
	worker.recordLastAstTiming(ProjectIndexAstTiming{UsedStaticIndex: true})

	patch, err := worker.IndexProjectLintPatch(context.Background(), projectindex.ProjectLintIndexRequest{
		Root:               root,
		ProjectName:        "static-index-lint",
		ASTUsedStaticIndex: true,
		PreviousIndex: store.IndexData{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
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
	if len(patch.Facts.LintFindings) != 1 || patch.Facts.LintFindings[0].RuleID != "definition.missing_eval_coverage" {
		t.Fatalf("lint findings = %+v, want definition.missing_eval_coverage", patch.Facts.LintFindings)
	}
	if bytes.Contains(compiler.finalizeLintFacts, []byte(`"lintFindings"`)) {
		t.Fatalf("lint facts = %s, should not echo previous lint findings", compiler.finalizeLintFacts)
	}
}

func TestWorkerIndexProjectLintPatchSkipsTypeScriptAstRuns(t *testing.T) {
	compiler := &staticIndexLintCompiler{root: "/repo"}
	worker := &Bundle{syntaxParser: compiler}

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
	compiler := &staticIndexLintCompiler{
		root:              "/repo",
		wantExtensionFact: []byte("rule:prefetched"),
	}
	worker := &Bundle{syntaxParser: compiler}
	worker.recordLastAstTiming(ProjectIndexAstTiming{UsedStaticIndex: true})

	_, err := worker.IndexProjectLintPatch(context.Background(), projectindex.ProjectLintIndexRequest{
		Root:               "/repo",
		ProjectName:        "static-index-lint",
		ASTUsedStaticIndex: true,
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

type staticIndexLintCompiler struct {
	root                   string
	finalizeCalls          int
	finalizeLintFacts      json.RawMessage
	finalizeExtensionFacts json.RawMessage
	wantExtensionFact      []byte
}

func (c *staticIndexLintCompiler) StaticIndexPrepare(context.Context, protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	return protocol.PrepareResponse{}, fmt.Errorf("StaticIndexPrepare should not be called by lint finalize")
}

func (c *staticIndexLintCompiler) StaticIndexAnalyzeStream(context.Context, protocol.AnalyzeRequest, protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	return protocol.AnalyzeResponse{}, fmt.Errorf("StaticIndexAnalyzeStream should not be called by lint finalize")
}

func (c *staticIndexLintCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	if request.PatchPhase != "quality" {
		return protocol.FinalizeResponse{}, fmt.Errorf("patch phase = %q, want quality", request.PatchPhase)
	}
	if request.EmitBuiltinLints == nil || !*request.EmitBuiltinLints {
		return protocol.FinalizeResponse{}, fmt.Errorf("emitBuiltinLints = %v, want true", request.EmitBuiltinLints)
	}
	if len(request.NativeFacts) != 0 {
		return protocol.FinalizeResponse{}, fmt.Errorf("native facts = %d, want lint-only finalize", len(request.NativeFacts))
	}
	if request.ExtensionFacts == nil {
		return protocol.FinalizeResponse{}, fmt.Errorf("extension facts slice is nil, want empty JSON array")
	}
	for _, fact := range request.ExtensionFacts {
		c.finalizeExtensionFacts = append(c.finalizeExtensionFacts, fact...)
	}
	if len(c.wantExtensionFact) == 0 && len(request.ExtensionFacts) != 0 {
		return protocol.FinalizeResponse{}, fmt.Errorf("extension facts = %s, want none", c.finalizeExtensionFacts)
	}
	if len(c.wantExtensionFact) > 0 && !bytes.Contains(c.finalizeExtensionFacts, c.wantExtensionFact) {
		return protocol.FinalizeResponse{}, fmt.Errorf("extension facts = %s, want %s", c.finalizeExtensionFacts, c.wantExtensionFact)
	}
	for _, fact := range request.LintFacts {
		c.finalizeLintFacts = append(c.finalizeLintFacts, fact...)
	}
	if !bytes.Contains(c.finalizeLintFacts, []byte(`"definitions"`)) {
		return protocol.FinalizeResponse{}, fmt.Errorf("lint facts = %s, want definitions", c.finalizeLintFacts)
	}
	events, err := staticIndexLintPatchEvents(c.root)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
		Telemetry:       staticIndexTestTelemetry(0, 0, 0, 0),
	}, nil
}

func (c *staticIndexLintCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexLintCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by lint finalize")
}

func (c *staticIndexLintCompiler) Concurrency() int { return 1 }

func (c *staticIndexLintCompiler) Close() error { return nil }

var _ frontend.Parser = (*staticIndexLintCompiler)(nil)
var _ StaticCompiler = (*staticIndexLintCompiler)(nil)

func staticIndexLintPatchEvents(root string) ([]json.RawMessage, error) {
	tx := "tx-static-index-lint"
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
					"factId":        "lintFindings:lint:definition.missing_eval_coverage:prompt:writer",
					"kind":          "lintFindings",
					"phase":         "quality",
					"projectRoot":   root,
					"producer":      map[string]any{"name": workerProducer, "version": "test"},
					"fidelity":      "inferred",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.lint"},
					"fact": map[string]any{
						"id":         "lint:definition.missing_eval_coverage:prompt:writer",
						"ruleId":     "definition.missing_eval_coverage",
						"severity":   "info",
						"category":   "evals",
						"maturity":   "preview",
						"confidence": "high",
						"profiles":   []any{"recommended", "strict"},
						"title":      "Definition has no Eval coverage",
						"message":    "writer has no associated Eval coverage.",
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
			"patch":           map[string]any{"schemaVersion": 1, "phase": "quality", "project": map[string]any{"root": root, "name": "static-index-lint"}, "startedAt": "1970-01-01T00:00:00.000Z", "finishedAt": "1970-01-01T00:00:00.000Z", "status": "ok"},
			"summary":         map[string]any{"factCount": 1, "decision": map[string]any{"staticIndexComplete": true}},
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
