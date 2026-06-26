package compat

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestLoadManifestBuildsStaticHostManifestRequest(t *testing.T) {
	reader := &recordingReader{response: json.RawMessage(`{"method":"loadStaticExtensionHostManifest","root":"/repo","nativeCompilerProtocolVersion":1,"manifest":{},"node":{"started":true},"nativeOnlyEligible":true}`)}

	manifest, err := LoadManifest(context.Background(), reader, "/repo", "/repo/crux.config.ts")

	if err != nil {
		t.Fatalf("LoadManifest error = %v", err)
	}
	if reader.request.Method != "loadStaticExtensionHostManifest" || reader.request.Root != "/repo" || reader.request.ConfigPath != "/repo/crux.config.ts" {
		t.Fatalf("request = %+v, want static host manifest request", reader.request)
	}
	if reader.request.NativeCompilerProtocolVersion != protocol.Version {
		t.Fatalf("protocol version = %d, want %d", reader.request.NativeCompilerProtocolVersion, protocol.Version)
	}
	if reader.artifact != projectindex.ProjectIndexArtifactStaticExtensionHostManifest {
		t.Fatalf("artifact = %q, want static host manifest", reader.artifact)
	}
	if !manifest.NativeOnlyEligible {
		t.Fatalf("manifest = %+v, want decoded response", manifest)
	}
}

func TestExtractEvidenceFactsBuildsEvidenceRequest(t *testing.T) {
	reader := &recordingReader{response: json.RawMessage(`{"method":"extractStaticEvidenceBatch","root":"/repo","facts":{"definitions":[]}}`)}

	facts, err := ExtractEvidenceFacts(context.Background(), reader, "/repo", "/repo/crux.config.ts", "project", []json.RawMessage{json.RawMessage(`{"id":"job"}`)})

	if err != nil {
		t.Fatalf("ExtractEvidenceFacts error = %v", err)
	}
	if reader.request.Method != "extractStaticEvidenceBatch" || reader.request.ResolutionMode != "config-policy" {
		t.Fatalf("request = %+v, want evidence batch request", reader.request)
	}
	if len(reader.request.Jobs) != 1 || string(reader.request.Jobs[0]) != `{"id":"job"}` {
		t.Fatalf("jobs = %s, want evidence job", reader.request.Jobs)
	}
	if reader.artifact != projectindex.ProjectIndexArtifactStaticExtensionEvidenceBatch {
		t.Fatalf("artifact = %q, want evidence batch", reader.artifact)
	}
	if len(facts) != 1 || string(facts[0]) != `{"definitions":[]}` {
		t.Fatalf("facts = %s, want grouped evidence facts", facts)
	}
}

func TestCheckRuleFactsBuildsRuleRequest(t *testing.T) {
	reader := &recordingReader{response: json.RawMessage(`{"method":"checkStaticRules","root":"/repo","facts":{"lintFindings":[]}}`)}
	files := []string{"src/writer.ts"}

	facts, err := CheckRuleFacts(context.Background(), reader, "/repo", "/repo/crux.config.ts", "project", projectindex.IndexPatch{
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt"}},
		},
	}, files)
	files[0] = "mutated.ts"

	if err != nil {
		t.Fatalf("CheckRuleFacts error = %v", err)
	}
	if reader.request.Method != "checkStaticRules" || reader.request.ResolutionMode != "config-policy" || !reader.request.NativeLintFinalize {
		t.Fatalf("request = %+v, want static rule request", reader.request)
	}
	if len(reader.request.Files) != 1 || reader.request.Files[0] != "src/writer.ts" {
		t.Fatalf("files = %v, want copied lint files", reader.request.Files)
	}
	if !bytes.Contains(reader.request.Graph, []byte(`"prompt:writer"`)) {
		t.Fatalf("graph = %s, want definition graph", reader.request.Graph)
	}
	if reader.artifact != projectindex.ProjectIndexArtifactStaticRuleCheck {
		t.Fatalf("artifact = %q, want rule check", reader.artifact)
	}
	if len(facts) != 1 || string(facts[0]) != `{"lintFindings":[]}` {
		t.Fatalf("facts = %s, want grouped rule facts", facts)
	}
}

type recordingReader struct {
	request  indexwire.Request
	artifact projectindex.ProjectIndexArtifactKind
	response json.RawMessage
}

func (r *recordingReader) ReadArtifact(_ context.Context, request indexwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	r.request = request
	r.artifact = artifact
	return r.response, nil
}
