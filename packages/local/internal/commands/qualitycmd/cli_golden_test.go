package qualitycmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/domain"
)

func assertCommandGolden(t *testing.T, name string, got string) {
	t.Helper()
	if strings.Contains(got, "\x1b") {
		t.Fatalf("%s golden output contained an ANSI escape:\n%q", name, got)
	}
	path := filepath.Join("testdata", "cli-goldens", name+".golden")
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v\nactual:\n%s", path, err, got)
	}
	if got != string(want) {
		t.Fatalf("%s golden mismatch\n--- want\n%s\n--- got\n%s", name, string(want), got)
	}
}

func TestQualityListPlainGolden(t *testing.T) {
	var out bytes.Buffer

	renderQualityList(&out, []domain.QualityManifest{
		qualityListManifest("memory.contracts", "evaluate", "evals/memory.eval.ts", "score", 2),
		qualityListManifest("prompt.title", "prompt-tests", "", "expect", 1),
	})

	assertCommandGolden(t, "quality-list", out.String())
}

func qualityListManifest(id, source, file, kind string, cases int) domain.QualityManifest {
	manifest := domain.QualityManifest{ID: id, Source: source, File: file}
	manifest.Task.Kind = kind
	manifest.Cases = make([]struct {
		CaseID string `json:"caseId"`
		Name   string `json:"name,omitempty"`
		Trials int    `json:"trials"`
	}, cases)
	return manifest
}
