package staticrun

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticpatch"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

func TestRunFinalizesAnalyzerAndEvidenceFacts(t *testing.T) {
	root, sourceFile := writeSource(t)
	compiler := &recordingCompiler{root: root, sourceFile: sourceFile}
	evidenceCalls := 0

	result, err := Run(context.Background(), Request{
		Root:         root,
		ProjectName:  "static-run",
		Plan:         testPlan(root, sourceFile),
		Compiler:     compiler,
		PatchOptions: testPatchOptions(root),
		Evidence: func(_ context.Context, jobs []json.RawMessage) ([]json.RawMessage, error) {
			evidenceCalls++
			if len(jobs) != 1 || !bytes.Contains(jobs[0], []byte("needs-host")) {
				t.Fatalf("evidence jobs = %s, want needs-host job", jobs)
			}
			return []json.RawMessage{json.RawMessage(`{"evidence":true}`)}, nil
		},
	})

	if err != nil {
		t.Fatalf("Run error = %v", err)
	}
	if !result.Used {
		t.Fatal("Used = false, want native static patch")
	}
	if result.NodeReason != ReasonEvidence {
		t.Fatalf("NodeReason = %q, want %q", result.NodeReason, ReasonEvidence)
	}
	if evidenceCalls != 1 {
		t.Fatalf("evidence calls = %d, want 1", evidenceCalls)
	}
	if compiler.finalizeCalls != 1 {
		t.Fatalf("finalize calls = %d, want 1", compiler.finalizeCalls)
	}
	if result.Patch.Project.Root != root {
		t.Fatalf("patch root = %q, want %q", result.Patch.Project.Root, root)
	}
	if result.Patch.SemanticSourceProfile == nil || len(result.Patch.SemanticSourceProfile.Files) != 1 {
		t.Fatalf("semantic source profile = %+v, want profile from Go source input", result.Patch.SemanticSourceProfile)
	}
}

func TestRunEvidenceErrorRequiresNodeWithoutFinalize(t *testing.T) {
	root, sourceFile := writeSource(t)
	compiler := &recordingCompiler{root: root, sourceFile: sourceFile}
	wantErr := errors.New("host unavailable")

	result, err := Run(context.Background(), Request{
		Root:         root,
		ProjectName:  "static-run",
		Plan:         testPlan(root, sourceFile),
		Compiler:     compiler,
		PatchOptions: testPatchOptions(root),
		Evidence: func(context.Context, []json.RawMessage) ([]json.RawMessage, error) {
			return nil, wantErr
		},
	})

	if err != nil {
		t.Fatalf("Run error = %v, want node fallback result", err)
	}
	if result.Used {
		t.Fatal("Used = true, want fallback")
	}
	if result.NodeReason != ReasonEvidence {
		t.Fatalf("NodeReason = %q, want %q", result.NodeReason, ReasonEvidence)
	}
	if compiler.finalizeCalls != 0 {
		t.Fatalf("finalize calls = %d, want 0", compiler.finalizeCalls)
	}
}

type recordingCompiler struct {
	root          string
	sourceFile    string
	finalizeCalls int
}

func (c *recordingCompiler) NativeStaticPrepare(_ context.Context, request staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	if request.ProjectName != "static-run" {
		return staticprotocol.PrepareResponse{}, fmt.Errorf("project name = %q, want static-run", request.ProjectName)
	}
	return staticprotocol.PrepareResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.PrepareMethod,
		Plan: staticprotocol.Plan{
			Root:         request.Root,
			ProjectName:  request.ProjectName,
			Files:        append([]staticprotocol.SourceFile(nil), request.Files...),
			PrimaryFiles: append([]staticprotocol.SourceFile(nil), request.PrimaryFiles...),
			CacheMisses:  append([]staticprotocol.SourceFile(nil), request.Files...),
		},
	}, nil
}

func (c *recordingCompiler) NativeStaticAnalyzeStream(_ context.Context, request staticprotocol.AnalyzeRequest, handle staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error) {
	if !request.Stream {
		return staticprotocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	if len(request.Files) != 1 || request.Files[0].File != c.sourceFile || request.Files[0].SourceText == "" {
		return staticprotocol.AnalyzeResponse{}, fmt.Errorf("analyze files = %+v, want source text for %s", request.Files, c.sourceFile)
	}
	if handle != nil {
		if err := handle(staticprotocol.AnalyzeStreamEvent{
			OK:                    true,
			Type:                  "extensionEvidenceJobs",
			ExtensionEvidenceJobs: []json.RawMessage{json.RawMessage(`{"job":"needs-host"}`)},
		}); err != nil {
			return staticprotocol.AnalyzeResponse{}, err
		}
	}
	return staticprotocol.AnalyzeResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.AnalyzeMethod,
		Facts:           []json.RawMessage{json.RawMessage(`{"native":true}`)},
	}, nil
}

func (c *recordingCompiler) NativeStaticFinalizeStream(_ context.Context, request staticprotocol.FinalizeRequest, handle staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error) {
	c.finalizeCalls++
	if !request.Stream {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	if len(request.NativeFacts) != 1 || !bytes.Contains(request.NativeFacts[0], []byte("native")) {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("native facts = %s, want analyzer facts", request.NativeFacts)
	}
	if len(request.ExtensionFacts) != 2 ||
		!bytes.Contains(request.ExtensionFacts[0], []byte("sourceGraph")) ||
		!bytes.Contains(request.ExtensionFacts[1], []byte("evidence")) {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("extension facts = %s, want source graph and evidence facts", request.ExtensionFacts)
	}
	events := completePatchEvents(c.root)
	for _, event := range events {
		if err := handle(staticprotocol.FinalizeStreamEvent{OK: true, Type: "event", Event: event}); err != nil {
			return staticprotocol.FinalizeResponse{}, err
		}
	}
	return staticprotocol.FinalizeResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.FinalizeMethod,
		Events:          events,
	}, nil
}

func writeSource(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir source dir: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'static-run' })\n"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	return root, sourceFile
}

func testPlan(root, sourceFile string) projectindex.ProjectStaticSyntaxPlan {
	return projectindex.ProjectStaticSyntaxPlan{
		Root:             root,
		ProjectName:      "static-run",
		Files:            []string{sourceFile},
		PrimaryFiles:     []string{sourceFile},
		FilesToParse:     []string{sourceFile},
		CacheMisses:      []string{sourceFile},
		NativeAstEnabled: true,
		StaticInterests:  json.RawMessage(`{"extractors":[]}`),
		SourceGraph:      json.RawMessage(`{"schemaVersion":1,"producedBy":"@crux/indexer","capabilities":[],"shards":[]}`),
	}
}

func testPatchOptions(root string) staticpatch.Options {
	return staticpatch.Options{
		Root:             root,
		MaxBytes:         1 << 20,
		MaxFactsPerBatch: 100,
		Producer:         "test",
	}
}

func completePatchEvents(root string) []json.RawMessage {
	return []json.RawMessage{
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:start","transactionId":"tx","phase":"ast","root":%q,"startedAt":"1970-01-01T00:00:00.000Z"}`, root)),
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:done","transactionId":"tx","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":%q},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok","invalidates":{"all":true}},"summary":{"factCount":0,"decision":{"nativeStaticComplete":true}}}`, root)),
	}
}
