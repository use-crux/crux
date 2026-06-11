package qualityfs

import "path/filepath"

func applyCassetteIssues(summaries []Cassette, issues []CassetteIssue) []Cassette {
	indexByPath := map[string]int{}
	for index, summary := range summaries {
		indexByPath[summary.Path] = index
		indexByPath[filepath.Base(summary.Path)] = index
	}
	for _, issue := range issues {
		key := issue.Path
		index, exists := indexByPath[key]
		if !exists {
			index, exists = indexByPath[filepath.Base(key)]
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
			indexByPath[issue.Path] = index
			indexByPath[filepath.Base(issue.Path)] = index
		}

		summary := summaries[index]
		if summary.Boundaries == nil {
			summary.Boundaries = map[string]CassetteBoundary{}
		}
		kind := nonEmptyString(issue.Kind, "unknown")
		boundary := summary.Boundaries[kind]
		boundary.Count++
		switch issue.Status {
		case "missing":
			summary.MissingCount++
			boundary.Missing++
		case "mismatch":
			summary.MismatchCount++
			boundary.Mismatched++
		}
		summary.Boundaries[kind] = boundary

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
		summary.Status = cassetteStatus(summary)
		summary.Coverage = cassetteCoverage(summary)
		summary.HitRate = cassetteHitRate(summary)
		summaries[index] = summary
	}
	for index, summary := range summaries {
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
