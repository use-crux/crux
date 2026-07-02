// Package uitest contains deterministic render-test helpers for the TUI.
package uitest

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "update TUI golden files")

// Golden compares got to testdata/<name>.golden.
func Golden(t *testing.T, name string, got string) {
	t.Helper()

	path := filepath.Join("testdata", name+".golden")
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("create golden directory: %v", err)
		}
		if err := os.WriteFile(path, []byte(normalizeGolden(got)), 0o644); err != nil {
			t.Fatalf("update golden %s: %v", path, err)
		}
		return
	}

	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v", path, err)
	}
	wantText := normalizeGolden(string(want))
	gotText := normalizeGolden(got)
	if wantText != gotText {
		t.Fatalf("golden %s mismatch\n--- want\n%s\n--- got\n%s", path, wantText, gotText)
	}
}

func normalizeGolden(s string) string {
	lines := strings.Split(s, "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " \t")
	}
	return strings.Join(lines, "\n")
}
