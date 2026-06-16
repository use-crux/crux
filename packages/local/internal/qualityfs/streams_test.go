package qualityfs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJSONLineReaderReportsLineNumbers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	if err := os.WriteFile(path, []byte("{\"ok\":true}\n{\n"), 0644); err != nil {
		t.Fatalf("write jsonl: %v", err)
	}

	_, err := readJSONLines(path)
	if err == nil {
		t.Fatalf("readJSONLines error = nil, want invalid line")
	}
	if !strings.Contains(err.Error(), "line 2") {
		t.Fatalf("readJSONLines error = %q, want line number", err)
	}
}
