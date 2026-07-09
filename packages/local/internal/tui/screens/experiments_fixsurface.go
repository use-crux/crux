package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Fix-surface + dataset-provenance projection for the Experiments screen
// (blueprint §12.5). The TUI is deliberately minimal: fix surfaces collapse to
// single letters on failing cells and the dataset fingerprint is shown short
// in the detail header. The classification itself is core-owned (I5); this only
// renders the failure artifacts already embedded in the record.

var fixSurfaceLetter = map[string]string{
	"prompt":      "P",
	"context":     "C",
	"retriever":   "R",
	"tool-schema": "T",
	"handoff":     "H",
	"judge":       "J",
	"flake":       "F",
	"unknown":     "?",
}

// fixSurfaceLetters renders a cell's suggested fix surfaces as space-separated
// single letters (e.g. "P R"), deduped and in order.
func fixSurfaceLetters(surfaces []string) string {
	seen := map[string]bool{}
	letters := make([]string, 0, len(surfaces))
	for _, surface := range surfaces {
		letter := fixSurfaceLetter[surface]
		if letter == "" {
			letter = "?"
		}
		if seen[letter] {
			continue
		}
		seen[letter] = true
		letters = append(letters, letter)
	}
	return strings.Join(letters, " ")
}

// failureArtifactForCell finds the failure artifact for one cell (case×variant×trial).
func failureArtifactForCell(failures []api.QualityFailureArtifact, caseID, variant string, trial int) *api.QualityFailureArtifact {
	for i := range failures {
		f := &failures[i]
		if f.CaseID == caseID && f.Variant == variant && f.Trial == trial {
			return f
		}
	}
	return nil
}

// datasetFingerprintShort returns a shortened dataset content fingerprint for
// the experiment (all cells from one versioned dataset share it), or "".
func datasetFingerprintShort(failures []api.QualityFailureArtifact) string {
	for i := range failures {
		prov := failures[i].DatasetProvenance
		if prov == nil || prov.ContentFingerprint == "" {
			continue
		}
		fp := prov.ContentFingerprint
		if len(fp) > 10 {
			return fp[:10] + "…"
		}
		return fp
	}
	return ""
}
