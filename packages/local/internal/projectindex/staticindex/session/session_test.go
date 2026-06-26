package session

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestRunPlansDisabledStaticIndexWithoutCompiler(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	wantPlan := projectindex.ProjectStaticSyntaxPlan{
		Root:                root,
		ProjectName:         "demo",
		StaticSyntaxEnabled: false,
	}
	wantTimings := []projectindex.ProjectIndexPhaseTiming{{
		Name:       planner.TimingConfig,
		DurationMs: 2.5,
		Count:      1,
	}}
	plannerCalls := 0
	evidenceCalls := 0

	result, err := Run(context.Background(), Options{
		Root:        root,
		ConfigPath:  "crux.config.ts",
		ProjectName: "demo",
		Planner: PlannerFunc(func(ctx context.Context, gotRoot, gotConfigPath, gotProjectName string) (planner.InspectResult, error) {
			plannerCalls++
			if gotRoot != root || gotConfigPath != "crux.config.ts" || gotProjectName != "demo" {
				t.Fatalf("planner args = (%q, %q, %q), want (%q, %q, %q)", gotRoot, gotConfigPath, gotProjectName, root, "crux.config.ts", "demo")
			}
			return planner.InspectResult{
				Plan:        wantPlan,
				Timings:     wantTimings,
				NodeStarted: true,
				NodeReasons: []string{planner.ReasonConfig},
			}, nil
		}),
		Evidence: func(context.Context, []json.RawMessage) ([]json.RawMessage, error) {
			evidenceCalls++
			return nil, nil
		},
	})

	if err != nil {
		t.Fatalf("Run error = %v", err)
	}
	if result.Status != StatusDisabled {
		t.Fatalf("Status = %q, want %q", result.Status, StatusDisabled)
	}
	if plannerCalls != 1 {
		t.Fatalf("planner calls = %d, want 1", plannerCalls)
	}
	if evidenceCalls != 0 {
		t.Fatalf("evidence calls = %d, want 0", evidenceCalls)
	}
	if !reflect.DeepEqual(result.Plan, wantPlan) {
		t.Fatalf("Plan = %+v, want %+v", result.Plan, wantPlan)
	}
	if !reflect.DeepEqual(result.PlanTimings, wantTimings) {
		t.Fatalf("PlanTimings = %+v, want %+v", result.PlanTimings, wantTimings)
	}
	if !reflect.DeepEqual(result.NodeReasons, []string{planner.ReasonConfig}) {
		t.Fatalf("NodeReasons = %v, want [%s]", result.NodeReasons, planner.ReasonConfig)
	}
	if result.UsedStaticIndex {
		t.Fatal("UsedStaticIndex = true, want false")
	}
}

func TestRunExecutesSchedulableStaticIndexPlan(t *testing.T) {
	t.Parallel()

	root, sourceFile := writeSessionSource(t)
	compiler := &sessionCompiler{root: root, sourceFile: sourceFile}

	result, err := Run(context.Background(), Options{
		Root:        root,
		ProjectName: "demo",
		Planner: PlannerFunc(func(context.Context, string, string, string) (planner.InspectResult, error) {
			return planner.InspectResult{Plan: sessionPlan(root, sourceFile)}, nil
		}),
		Compiler: compiler,
		PatchOptions: PatchOptions{
			Root:             root,
			MaxBytes:         1 << 20,
			MaxFactsPerBatch: 100,
			Producer:         "session-test",
		},
	})

	if err != nil {
		t.Fatalf("Run error = %v", err)
	}
	if result.Status != StatusComplete {
		t.Fatalf("Status = %q, want %q", result.Status, StatusComplete)
	}
	if !result.UsedStaticIndex {
		t.Fatal("UsedStaticIndex = false, want true")
	}
	if result.Patch.Project.Root != root {
		t.Fatalf("patch root = %q, want %q", result.Patch.Project.Root, root)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 || compiler.finalizeCalls != 1 {
		t.Fatalf("compiler calls = prepare %d analyze %d finalize %d, want 1 each", compiler.prepareCalls, compiler.analyzeCalls, compiler.finalizeCalls)
	}
}

type sessionCompiler struct {
	root          string
	sourceFile    string
	prepareCalls  int
	analyzeCalls  int
	finalizeCalls int
}

func (c *sessionCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
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
	}, nil
}

func (c *sessionCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	if len(request.Files) != 1 || request.Files[0].File != c.sourceFile || request.Files[0].SourceText == "" {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze files = %+v, want source text for %s", request.Files, c.sourceFile)
	}
	return protocol.AnalyzeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Facts:           []json.RawMessage{json.RawMessage(`{"native":true}`)},
	}, nil
}

func (c *sessionCompiler) StaticIndexFinalizeStream(_ context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	if len(request.NativeFacts) != 1 || !bytes.Contains(request.NativeFacts[0], []byte("native")) {
		return protocol.FinalizeResponse{}, fmt.Errorf("native facts = %s, want analyzer facts", request.NativeFacts)
	}
	events := sessionPatchEvents(c.root)
	for _, event := range events {
		if err := handle(protocol.FinalizeStreamEvent{OK: true, Type: "event", Event: event}); err != nil {
			return protocol.FinalizeResponse{}, err
		}
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
	}, nil
}

func writeSessionSource(t *testing.T) (string, string) {
	t.Helper()

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir source dir: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'session' })\n"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	return root, sourceFile
}

func sessionPlan(root, sourceFile string) projectindex.ProjectStaticSyntaxPlan {
	return projectindex.ProjectStaticSyntaxPlan{
		Root:                root,
		ProjectName:         "demo",
		Files:               []string{sourceFile},
		PrimaryFiles:        []string{sourceFile},
		FilesToParse:        []string{sourceFile},
		CacheMisses:         []string{sourceFile},
		StaticSyntaxEnabled: true,
		StaticHost:          json.RawMessage(`{"nativeOnlyEligible":false}`),
		StaticInterests:     json.RawMessage(`{"extractors":[]}`),
		SourceGraph:         json.RawMessage(`{"schemaVersion":1,"producedBy":"@use-crux/indexer","capabilities":[],"shards":[]}`),
	}
}

func sessionPatchEvents(root string) []json.RawMessage {
	return []json.RawMessage{
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:start","transactionId":"tx","phase":"ast","root":%q,"startedAt":"1970-01-01T00:00:00.000Z"}`, root)),
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:done","transactionId":"tx","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":%q},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok","invalidates":{"all":true}},"summary":{"factCount":0,"decision":{"staticIndexComplete":true}}}`, root)),
	}
}
