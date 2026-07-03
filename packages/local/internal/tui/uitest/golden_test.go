package uitest

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGoldenNormalizesTrailingWhitespace(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	if err := os.MkdirAll("testdata", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join("testdata", "trim.golden"), []byte("alpha  \n beta\t\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	Golden(t, "trim", "alpha\n beta\n")
}
