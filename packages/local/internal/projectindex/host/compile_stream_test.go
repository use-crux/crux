package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/patch"
)

func TestWorkerStaticIndexCompilerUsesCompileStreamWhenNativeOnly(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	sourceFile := filepath.Join(srcDir, "writer.ts")
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'static-index-cutover' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	compiler := &staticIndexCompileCutoverCompiler{
		staticIndexCutoverCompiler: staticIndexCutoverCompiler{root: root, sourceFile: sourceFile},
	}
	worker := &Bundle{}
	plan := projectindex.ProjectStaticSyntaxPlan{
		Root:                root,
		ProjectName:         "static-index-cutover",
		Files:               []string{sourceFile},
		PrimaryFiles:        []string{sourceFile},
		FilesToParse:        []string{sourceFile},
		CacheMisses:         []string{sourceFile},
		CallNames:           []string{"prompt"},
		ConstructorNames:    []string{"Agent"},
		StaticSyntaxEnabled: true,
		StaticHost:          json.RawMessage(`{"nativeOnlyEligible":true}`),
		StaticInterests:     json.RawMessage(`{"extractors":[]}`),
		SourceGraph:         json.RawMessage(`{"schemaVersion":1,"producedBy":"@use-crux/indexer","capabilities":[],"shards":[]}`),
	}

	patch, _, usedStaticIndex, err := worker.indexProjectAstPatchFromStaticIndexCompiler(context.Background(), root, "", "static-index-cutover", plan, compiler)
	if err != nil {
		t.Fatalf("indexProjectAstPatchFromStaticIndexCompiler error = %v", err)
	}
	if !usedStaticIndex {
		t.Fatal("usedStaticIndex = false, want true")
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:static-index-cutover" {
		t.Fatalf("definitions = %+v, want Static Index compile stream result", patch.Facts.Definitions)
	}
	if patch.SemanticSourceProfile == nil || len(patch.SemanticSourceProfile.Files) != 1 || patch.SemanticSourceProfile.Files[0].File != sourceFile {
		t.Fatalf("semantic source profile = %+v, want Go-owned source input profile", patch.SemanticSourceProfile)
	}
	if compiler.compileCalls != 1 || compiler.analyzeCalls != 0 || compiler.finalizeCalls != 0 {
		t.Fatalf("Static Index calls = compile %d analyze %d finalize %d, want compile only after prepare", compiler.compileCalls, compiler.analyzeCalls, compiler.finalizeCalls)
	}
}

type staticIndexCompileCutoverCompiler struct {
	staticIndexCutoverCompiler
	compileCalls int
}

func (c *staticIndexCompileCutoverCompiler) StaticIndexCompileStream(_ context.Context, request protocol.CompileRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	c.compileCalls++
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("compile stream flag = false, want true")
	}
	if !staticIndexAnalyzeFilesContain(request.Files, c.sourceFile) {
		return protocol.FinalizeResponse{}, fmt.Errorf("compile files = %+v, want selected file", request.Files)
	}
	if len(request.ExtensionFacts) != 1 || !bytes.Contains(request.ExtensionFacts[0], []byte("sourceGraph")) {
		return protocol.FinalizeResponse{}, fmt.Errorf("compile extension facts = %s, want source graph", request.ExtensionFacts)
	}
	events, err := staticIndexCutoverEvents(c.root)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.CompileMethod,
		Events:          events,
		Telemetry:       staticIndexTestTelemetry(1, 0, 1, len(request.Files)),
	}, handle)
}

var _ patch.CompileStreamer = (*staticIndexCompileCutoverCompiler)(nil)
