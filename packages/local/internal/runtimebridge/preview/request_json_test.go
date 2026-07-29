package preview

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPromptPreviewRequestJSONV1SharedGolden(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(
		"..", "..", "..", "..", "core", "__tests__", "prompt-preview-exact",
		"fixtures", "prompt-preview-request-json-v1.json",
	))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Version   string  `json:"version"`
		Value     Request `json:"value"`
		Canonical string  `json:"canonical"`
		ByteCount int     `json:"byteCount"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	encoded, err := MarshalRequestJSON(fixture.Value)
	if err != nil {
		t.Fatalf("MarshalRequestJSON: %v", err)
	}
	if fixture.Version != RequestJSONVersion {
		t.Fatalf("version = %q", fixture.Version)
	}
	if string(encoded) != fixture.Canonical {
		t.Fatalf("canonical bytes:\n got %q\nwant %q", encoded, fixture.Canonical)
	}
	if len(encoded) != fixture.ByteCount {
		t.Fatalf("byte count = %d, want %d", len(encoded), fixture.ByteCount)
	}
}
