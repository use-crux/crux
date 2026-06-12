package qualityfs

import "path/filepath"

func applyCassetteIssues(summaries []Cassette, issues []CassetteIssue) []Cassette {
	indexByPath := map[string]int{}
	indexByBase := map[string]int{}
	baseCounts := map[string]int{}
	addLookup := func(path string, index int) {
		indexByPath[path] = index
		base := filepath.Base(path)
		baseCounts[base]++
		if baseCounts[base] == 1 {
			indexByBase[base] = index
		} else {
			// Ambiguous basenames must not resolve issues to an arbitrary cassette.
			delete(indexByBase, base)
		}
	}
	for index, summary := range summaries {
		addLookup(summary.Path, index)
	}
	for _, issue := range issues {
		index, exists := indexByPath[issue.Path]
		if !exists {
			index, exists = indexByBase[filepath.Base(issue.Path)]
		}
		if !exists {
			summaries = append(summaries, Cassette{
				Path:       issue.Path,
				Mode:       "replay",
				Status:     "matching",
				Coverage:   1,
				Boundaries: map[string]CassetteBoundary{},
				Matchers:   []string{"kind", "target", "provider", "model"},
				Entries:    []CassetteEntry{},
			})
			index = len(summaries) - 1
			addLookup(issue.Path, index)
		}

		summary := summaries[index]
		kind := nonEmptyString(issue.Kind, "unknown")
		entry := CassetteEntry{
			ID:                issue.EntryID,
			CaseID:            issue.CaseID,
			Kind:              kind,
			TargetID:          issue.TargetID,
			Provider:          issue.Provider,
			Model:             issue.Model,
			Status:            issue.Status,
			Reason:            issue.Reason,
			RecordedAt:        issue.RecordedAt,
			SignatureExpected: issue.EntryID,
			SignatureCurrent:  issue.EntryID,
			DriftReason:       issue.Reason,
		}
		replaced := false
		for entryIndex, existing := range summary.Entries {
			if existing.ID != "" && existing.ID == issue.EntryID {
				summary.Entries[entryIndex] = entry
				replaced = true
				break
			}
		}
		if !replaced {
			summary.Entries = append(summary.Entries, entry)
		}
		summary.EntryCount = len(summary.Entries)
		summaries[index] = summary
	}
	for index, summary := range summaries {
		// Recompute counts from the final deduped entries so issues that
		// replaced an entry (same EntryID) are not counted twice.
		summary.MissingCount = 0
		summary.MismatchCount = 0
		boundaries := map[string]CassetteBoundary{}
		for _, entry := range summary.Entries {
			kind := nonEmptyString(entry.Kind, "unknown")
			boundary := boundaries[kind]
			boundary.Count++
			switch entry.Status {
			case "missing":
				summary.MissingCount++
				boundary.Missing++
			case "mismatch":
				summary.MismatchCount++
				boundary.Mismatched++
			}
			boundaries[kind] = boundary
		}
		summary.Boundaries = boundaries
		summary.Status = cassetteStatus(summary)
		summary.Coverage = cassetteCoverage(summary)
		summary.HitRate = cassetteHitRate(summary)
		summaries[index] = summary
	}
	return summaries
}

func cassetteHitRate(summary Cassette) float64 {
	if summary.EntryCount == 0 {
		return 0
	}
	hits := 0
	for _, entry := range summary.Entries {
		hits += entry.HitCount
	}
	if hits == 0 && summary.MissingCount == 0 && summary.MismatchCount == 0 {
		hits = summary.EntryCount
	}
	rate := float64(hits) / float64(summary.EntryCount)
	if rate > 1 {
		return 1
	}
	return rate
}

func cassetteStatus(summary Cassette) string {
	if summary.MismatchCount > 0 {
		return "mismatch"
	}
	if summary.MissingCount > 0 {
		return "missing"
	}
	return "matching"
}

func cassetteCoverage(summary Cassette) float64 {
	total := summary.EntryCount + summary.MissingCount
	if total == 0 {
		return 1
	}
	return float64(summary.EntryCount-summary.MismatchCount) / float64(total)
}
