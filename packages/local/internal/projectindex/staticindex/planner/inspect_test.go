package planner

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
)

func TestLoadConfigBuildsStaticIndexConfigRequest(t *testing.T) {
	reader := &recordingReader{
		responses: []json.RawMessage{json.RawMessage(`{"root":"/repo","nativeAstEnabled":true,"extensions":[]}`)},
	}

	config, err := LoadConfig(context.Background(), reader, "/repo", "/repo/crux.config.ts")

	if err != nil {
		t.Fatalf("LoadConfig error = %v", err)
	}
	if !config.StaticSyntaxEnabled {
		t.Fatalf("config = %+v, want decoded native AST config", config)
	}
	if len(reader.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(reader.requests))
	}
	request := reader.requests[0]
	if request.Method != "inspectProjectStaticIndexConfig" || request.Root != "/repo" || request.ConfigPath != "/repo/crux.config.ts" {
		t.Fatalf("request = %+v, want Static Index config request", request)
	}
	if reader.artifacts[0] != projectindex.ProjectIndexArtifactStaticIndexConfig {
		t.Fatalf("artifact = %q, want Static Index config", reader.artifacts[0])
	}
}

func TestInspectLoadsNodeConfigAndExtensionManifest(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	sourceFile := filepath.Join(srcDir, "writer.ts")
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'writer' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	configFile := filepath.Join(root, "crux.config.ts")
	reader := &recordingReader{
		responses: []json.RawMessage{
			json.RawMessage(`{"root":` + quote(root) + `,"configFile":` + quote(configFile) + `,"nativeAstEnabled":true,"extensions":[{"package":"@acme/indexer"}]}`),
			json.RawMessage(`{"method":"loadStaticExtensionHostManifest","root":` + quote(root) + `,"nativeCompilerProtocolVersion":1,"manifest":{"callNames":["workflow"],"staticHost":{"nativeOnlyEligible":false,"requiresTypeScriptHostForExtensions":true}},"node":{"started":true},"nativeOnlyEligible":false}`),
		},
	}

	result, err := Inspect(context.Background(), reader, root, configFile, "project")

	if err != nil {
		t.Fatalf("Inspect error = %v", err)
	}
	if !hasString(result.NodeReasons, ReasonConfig) || !hasString(result.NodeReasons, ReasonExtensions) {
		t.Fatalf("node reasons = %v, want config and extensions", result.NodeReasons)
	}
	if !hasString(result.Plan.CallNames, "workflow") {
		t.Fatalf("call names = %v, want extension call", result.Plan.CallNames)
	}
	if !hasString(result.Plan.Files, sourceFile) {
		t.Fatalf("files = %v, want project source file", result.Plan.Files)
	}
	if len(reader.requests) != 2 {
		t.Fatalf("requests = %d, want config and manifest", len(reader.requests))
	}
	if reader.requests[0].Method != "inspectProjectStaticIndexConfig" || reader.requests[1].Method != "loadStaticExtensionHostManifest" {
		t.Fatalf("requests = %+v, want config then manifest", reader.requests)
	}
}

type recordingReader struct {
	requests  []indexwire.Request
	artifacts []projectindex.ProjectIndexArtifactKind
	responses []json.RawMessage
}

func (r *recordingReader) ReadArtifact(_ context.Context, request indexwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	r.requests = append(r.requests, request)
	r.artifacts = append(r.artifacts, artifact)
	response := r.responses[0]
	r.responses = r.responses[1:]
	return response, nil
}

func quote(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func hasString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
