package server

import (
	"reflect"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type indexDeltaLints struct {
	Findings []store.IndexLintFinding `json:"findings"`
}

func lintDeltaForFile(file string, previous []store.IndexLintFinding, current []store.IndexLintFinding) *indexDeltaLints {
	previousFindings := lintFindingsForFile(file, previous)
	currentFindings := lintFindingsForFile(file, current)
	if reflect.DeepEqual(previousFindings, currentFindings) {
		return nil
	}
	return &indexDeltaLints{Findings: currentFindings}
}

func changedLintFiles(previous []store.IndexLintFinding, current []store.IndexLintFinding) []string {
	files := map[string]bool{}
	for _, finding := range previous {
		files[lintFindingFile(finding)] = true
	}
	for _, finding := range current {
		files[lintFindingFile(finding)] = true
	}

	changed := make([]string, 0, len(files))
	for file := range files {
		if !reflect.DeepEqual(lintFindingsForFile(file, previous), lintFindingsForFile(file, current)) {
			changed = append(changed, file)
		}
	}
	sort.Strings(changed)
	return changed
}

func lintFindingsForFile(file string, findings []store.IndexLintFinding) []store.IndexLintFinding {
	out := []store.IndexLintFinding{}
	for _, finding := range findings {
		if lintFindingFile(finding) == file {
			out = append(out, finding)
		}
	}
	return out
}

func lintFindingFile(finding store.IndexLintFinding) string {
	if finding.Source == nil {
		return ""
	}
	return finding.Source.File
}
