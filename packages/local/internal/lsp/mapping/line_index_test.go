package mapping

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLineIndexConvertsUTF8ColumnsToUTF16(t *testing.T) {
	file := filepath.Join(t.TempDir(), "unicode.ts")
	if err := os.WriteFile(file, []byte("ascii\nx😀中z\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	index := NewLineIndex()
	for _, test := range []struct {
		column int
		want   uint32
	}{
		{column: 1, want: 0},
		{column: 2, want: 1},
		{column: 6, want: 3},
		{column: 9, want: 4},
		{column: 99, want: 5},
	} {
		if got := index.UTF16Column(file, 2, test.column); got != test.want {
			t.Errorf("column %d = %d, want %d", test.column, got, test.want)
		}
	}
	if got := index.UTF16Column(filepath.Join(t.TempDir(), "missing.ts"), 1, 8); got != 7 {
		t.Fatalf("missing-file fallback = %d, want raw zero-based 7", got)
	}
}

func TestLineIndexInvalidationAndLeadingWhitespace(t *testing.T) {
	file := filepath.Join(t.TempDir(), "indent.ts")
	if err := os.WriteFile(file, []byte("\t  first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	index := NewLineIndex()
	if got := index.LeadingWhitespace(file, 1); got != "\t  " {
		t.Fatalf("indent = %q", got)
	}
	if err := os.WriteFile(file, []byte("    second\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := index.LeadingWhitespace(file, 1); got != "\t  " {
		t.Fatalf("cached indent = %q", got)
	}
	index.Invalidate(file)
	if got := index.LeadingWhitespace(file, 1); got != "    " {
		t.Fatalf("invalidated indent = %q", got)
	}
}
