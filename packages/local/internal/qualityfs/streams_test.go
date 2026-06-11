package qualityfs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadJSONLinesReportsLineNumbers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	if err := os.WriteFile(path, []byte("{\"ok\":true}\n{\n"), 0644); err != nil {
		t.Fatalf("write jsonl: %v", err)
	}

	_, err := ReadJSONLines(path)
	if err == nil {
		t.Fatalf("ReadJSONLines error = nil, want invalid line")
	}
	if !strings.Contains(err.Error(), "line 2") {
		t.Fatalf("ReadJSONLines error = %q, want line number", err)
	}
}
