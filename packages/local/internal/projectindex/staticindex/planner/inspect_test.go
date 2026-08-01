package planner

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

func TestLoadConfigBuildsStaticIndexConfigRequest(t *testing.T) {
	reader := &recordingReader{
		responses: []json.RawMessage{json.RawMessage(`{"root":"/repo","extensions":[]}`)},
	}

	config, err := LoadConfig(context.Background(), reader, "/repo", "/repo/crux.config.ts")

	if err != nil {
		t.Fatalf("LoadConfig error = %v", err)
	}
	if config.Root != "/repo" || len(config.Extensions) != 0 {
		t.Fatalf("config = %+v, want root and empty extensions", config)
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

func TestLoadConfigRejectsEscapingConfigDependency(t *testing.T) {
	reader := &recordingReader{responses: []json.RawMessage{json.RawMessage(`{"root":"/repo","configDependencies":["../base.json"],"extensions":[]}`)}}

	if _, err := LoadConfig(context.Background(), reader, "/repo", "/repo/crux.config.ts"); err == nil {
		t.Fatal("LoadConfig error = nil, want escaping config dependency rejection")
	}
}

func TestInspectDisablesCachesForUnboundedConfigClosure(t *testing.T) {
	root := t.TempDir()
	configFile := filepath.Join(root, "crux.config.ts")
	if err := os.WriteFile(configFile, []byte("export default {}\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	reader := &recordingReader{responses: []json.RawMessage{json.RawMessage(
		`{"root":` + quote(root) + `,"configFile":` + quote(configFile) + `,"configDependencies":["tsconfig.json"],"cacheDisabled":true,"extensions":[]}`,
	)}}

	result, err := Inspect(context.Background(), reader, root, configFile, "project")
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if !result.Plan.CacheDisabled || len(result.Plan.CacheInputs) != 0 {
		t.Fatalf("plan cacheDisabled=%v cacheInputs=%d, want disabled with no inputs", result.Plan.CacheDisabled, len(result.Plan.CacheInputs))
	}
	if len(result.Plan.ConfigDependencies) != 1 || result.Plan.ConfigDependencies[0] != "tsconfig.json" {
		t.Fatalf("plan config dependencies = %v", result.Plan.ConfigDependencies)
	}
}

func TestLoadConfigPreservesObservabilityPolicyTriState(t *testing.T) {
	for _, test := range []struct {
		name      string
		field     string
		wantKnown bool
		want      bool
	}{
		{
			name:      "configured",
			field:     `,"redactPatternsConfigured":true`,
			wantKnown: true,
			want:      true,
		},
		{
			name:      "known off",
			field:     `,"redactPatternsConfigured":false`,
			wantKnown: true,
		},
		{name: "unknown"},
	} {
		t.Run(test.name, func(t *testing.T) {
			reader := &recordingReader{
				responses: []json.RawMessage{
					json.RawMessage(
						`{"root":"/repo","extensions":[]` +
							test.field +
							`}`,
					),
				},
			}

			config, err := LoadConfig(
				context.Background(),
				reader,
				"/repo",
				"/repo/crux.config.ts",
			)
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if gotKnown := config.RedactPatternsConfigured != nil; gotKnown != test.wantKnown {
				t.Fatalf("known = %v, want %v", gotKnown, test.wantKnown)
			}
			if test.wantKnown &&
				*config.RedactPatternsConfigured != test.want {
				t.Fatalf(
					"configured = %v, want %v",
					*config.RedactPatternsConfigured,
					test.want,
				)
			}
		})
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
			json.RawMessage(`{"root":` + quote(root) + `,"configFile":` + quote(configFile) + `,"extensions":[{"package":"@acme/indexer"}]}`),
			json.RawMessage(`{"method":"loadStaticExtensionHostManifest","root":` + quote(root) + `,"nativeCompilerProtocolVersion":2,"manifest":{"callNames":["workflow"],"staticInterests":{"extractors":[{"extension":{"name":"@acme/indexer","version":"1"},"name":"workflow.define","calls":[{"name":"workflow"}]}]},"staticHost":{"nativeOnlyEligible":false,"requiresTypeScriptHostForExtensions":true}},"node":{"started":true},"nativeOnlyEligible":false}`),
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
	if !bytes.Contains(result.Plan.StaticInterests, []byte(`"extractors"`)) || !bytes.Contains(result.Plan.StaticInterests, []byte(`"workflow.define"`)) {
		t.Fatalf("static interests = %s, want extension extractor interests", result.Plan.StaticInterests)
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

func TestInspectDefaultManifestIncludesRuntimeTaskInterest(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	sourceFile := filepath.Join(srcDir, "task.ts")
	if err := os.WriteFile(sourceFile, []byte("export const embed = durableTask('embed-document', { run: async () => undefined })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	reader := &recordingReader{
		responses: []json.RawMessage{json.RawMessage(`{"root":` + quote(root) + `,"extensions":[]}`)},
	}

	result, err := Inspect(context.Background(), reader, root, "", "project")

	if err != nil {
		t.Fatalf("Inspect error = %v", err)
	}
	if !hasString(result.Plan.CallNames, "durableTask") {
		t.Fatalf("call names = %v, want durableTask", result.Plan.CallNames)
	}
	if !hasRuntimeTaskInterest(result.Plan.CallInterests) {
		t.Fatalf("call interests = %+v, want import-qualified durableTask interest", result.Plan.CallInterests)
	}
	if !hasString(result.Plan.Files, sourceFile) {
		t.Fatalf("files = %v, want runtime task source file", result.Plan.Files)
	}
}

type recordingReader struct {
	requests  []requestwire.Request
	artifacts []projectindex.ProjectIndexArtifactKind
	responses []json.RawMessage
}

func (r *recordingReader) ReadArtifact(_ context.Context, request requestwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
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

func hasRuntimeTaskInterest(values []projectindex.StaticCallInterest) bool {
	for _, value := range values {
		if value.Name != "durableTask" {
			continue
		}
		return hasString(value.ImportFrom, "@use-crux/core") && hasString(value.ImportFrom, "@use-crux/core/runtime")
	}
	return false
}
