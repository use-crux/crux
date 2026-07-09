package screens

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestFixSurfaceLetters(t *testing.T) {
	if got := fixSurfaceLetters([]string{"prompt", "retriever"}); got != "P R" {
		t.Errorf("prompt+retriever = %q, want %q", got, "P R")
	}
	if got := fixSurfaceLetters([]string{"tool-schema", "judge", "flake"}); got != "T J F" {
		t.Errorf("tool/judge/flake = %q, want %q", got, "T J F")
	}
	if got := fixSurfaceLetters([]string{"prompt", "prompt"}); got != "P" {
		t.Errorf("dedupe = %q, want %q", got, "P")
	}
	if got := fixSurfaceLetters(nil); got != "" {
		t.Errorf("empty = %q, want empty", got)
	}
}

func TestDatasetFingerprintShort(t *testing.T) {
	failures := []api.QualityFailureArtifact{
		{DatasetProvenance: &api.QualityFailureArtifactDataset{Path: "d.jsonl", ContentFingerprint: "sha256:abcdef0123456789"}},
	}
	if got := datasetFingerprintShort(failures); got != "sha256:abc…" {
		t.Errorf("short = %q, want %q", got, "sha256:abc…")
	}
	if got := datasetFingerprintShort(nil); got != "" {
		t.Errorf("no failures = %q, want empty", got)
	}
	if got := datasetFingerprintShort([]api.QualityFailureArtifact{{}}); got != "" {
		t.Errorf("no provenance = %q, want empty", got)
	}
}

func TestFailureArtifactForCell(t *testing.T) {
	failures := []api.QualityFailureArtifact{
		{CaseID: "c1", Variant: "candidate", Trial: 0, SuggestedFixSurfaces: []string{"prompt"}},
		{CaseID: "c2", Variant: "default", Trial: 1, SuggestedFixSurfaces: []string{"judge"}},
	}
	if f := failureArtifactForCell(failures, "c2", "default", 1); f == nil || len(f.SuggestedFixSurfaces) != 1 || f.SuggestedFixSurfaces[0] != "judge" {
		t.Errorf("c2 lookup = %+v", f)
	}
	if f := failureArtifactForCell(failures, "c1", "default", 0); f != nil {
		t.Errorf("mismatch must be nil, got %+v", f)
	}
}
