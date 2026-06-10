package indexread

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type qualityCassetteSummary struct {
	Path                 string                             `json:"path"`
	Mode                 string                             `json:"mode,omitempty"`
	Status               string                             `json:"status"`
	Coverage             float64                            `json:"coverage"`
	EntryCount           int                                `json:"entryCount"`
	MissingCount         int                                `json:"missingCount"`
	MismatchCount        int                                `json:"mismatchCount"`
	ProviderCallsAvoided int                                `json:"providerCallsAvoided"`
	Boundaries           map[string]qualityCassetteBoundary `json:"boundaries,omitempty"`
	Matchers             []string                           `json:"matchers,omitempty"`
	Entries              []qualityCassetteEntrySummary      `json:"entries,omitempty"`
	RecordedAt           string                             `json:"recordedAt,omitempty"`
	HitRate              float64                            `json:"hitRate"`
}

type qualityCassetteBoundary struct {
	Count      int `json:"count"`
	Missing    int `json:"missing,omitempty"`
	Mismatched int `json:"mismatched,omitempty"`
}

type qualityCassetteEntrySummary struct {
	ID                string `json:"id,omitempty"`
	CaseID            string `json:"caseId,omitempty"`
	Kind              string `json:"kind,omitempty"`
	TargetID          string `json:"targetId,omitempty"`
	Provider          string `json:"provider,omitempty"`
	Model             string `json:"model,omitempty"`
	Status            string `json:"status"`
	Reason            string `json:"reason,omitempty"`
	RecordedAt        string `json:"recordedAt,omitempty"`
	HitCount          int    `json:"hitCount,omitempty"`
	SignatureExpected string `json:"signatureExpected,omitempty"`
	SignatureCurrent  string `json:"signatureCurrent,omitempty"`
	DriftReason       string `json:"driftReason,omitempty"`
}

type qualityCassetteIssueRecord struct {
	Tag        string `json:"_tag"`
	Path       string `json:"path"`
	EntryID    string `json:"entryId,omitempty"`
	CaseID     string `json:"caseId,omitempty"`
	Kind       string `json:"kind,omitempty"`
	TargetID   string `json:"targetId,omitempty"`
	Provider   string `json:"provider,omitempty"`
	Model      string `json:"model,omitempty"`
	Status     string `json:"status"`
	Reason     string `json:"reason,omitempty"`
	RecordedAt string `json:"recordedAt"`
}

func readQualityCassettes(dir string) ([]qualityCassetteSummary, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			issues, issueErr := readQualityCassetteIssues(dir)
			if issueErr != nil {
				return nil, issueErr
			}
			return applyQualityCassetteIssues([]qualityCassetteSummary{}, issues), nil
		}
		return nil, err
	}
	summaries := []qualityCassetteSummary{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		summary, err := readQualityCassetteFile(path)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	issues, err := readQualityCassetteIssues(dir)
	if err != nil {
		return nil, err
	}
	return applyQualityCassetteIssues(summaries, issues), nil
}

func readQualityCassettesForProject(qualityDir string, projectRoot string) ([]qualityCassetteSummary, error) {
	workbench, err := readQualityCassettes(filepath.Join(qualityDir, "cassettes"))
	if err != nil {
		return nil, err
	}
	paths, err := discoverProjectCassettePaths(projectRoot)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	summaries := make([]qualityCassetteSummary, 0, len(workbench)+len(paths))
	for _, summary := range workbench {
		seen[summary.Path] = struct{}{}
		summaries = append(summaries, summary)
	}
	for _, path := range paths {
		if _, exists := seen[path]; exists {
			continue
		}
		summary, err := readQualityCassetteFile(path)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	sort.SliceStable(summaries, func(i, j int) bool {
		return summaries[i].Path < summaries[j].Path
	})
	return summaries, nil
}

func discoverProjectCassettePaths(root string) ([]string, error) {
	if root == "" {
		return []string{}, nil
	}
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	paths := []string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if shouldSkipQualityDiscoveryDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".cassette.json") {
			paths = append(paths, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	return paths, nil
}

func shouldSkipQualityDiscoveryDir(name string) bool {
	switch name {
	case "node_modules", ".git", ".cache", ".next", ".turbo", "dist", "build", "coverage", "generated":
		return true
	default:
		return false
	}
}

func readQualityCassetteFile(path string) (qualityCassetteSummary, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return qualityCassetteSummary{}, err
	}
	var cassette struct {
		Mode    string `json:"mode,omitempty"`
		Entries []struct {
			ID      string `json:"id,omitempty"`
			CaseID  string `json:"caseId,omitempty"`
			Request struct {
				Kind     string `json:"kind,omitempty"`
				TargetID string `json:"targetId,omitempty"`
				Provider string `json:"provider,omitempty"`
				Model    string `json:"model,omitempty"`
			} `json:"request"`
			Response struct {
				Error any `json:"error,omitempty"`
			} `json:"response"`
			RecordedAt string `json:"recordedAt"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(content, &cassette); err != nil {
		return qualityCassetteSummary{}, err
	}
	recordedAt := ""
	boundaries := map[string]qualityCassetteBoundary{}
	entrySummaries := make([]qualityCassetteEntrySummary, 0, len(cassette.Entries))
	providerCallsAvoided := 0
	if len(cassette.Entries) > 0 {
		recordedAt = cassette.Entries[0].RecordedAt
	}
	for _, cassetteEntry := range cassette.Entries {
		kind := nonEmptyString(cassetteEntry.Request.Kind, "unknown")
		boundary := boundaries[kind]
		boundary.Count++
		boundaries[kind] = boundary
		status := "recorded"
		if cassetteEntry.Response.Error != nil {
			status = "error"
		} else {
			providerCallsAvoided++
		}
		entrySummaries = append(entrySummaries, qualityCassetteEntrySummary{
			ID:         cassetteEntry.ID,
			CaseID:     cassetteEntry.CaseID,
			Kind:       kind,
			TargetID:   cassetteEntry.Request.TargetID,
			Provider:   cassetteEntry.Request.Provider,
			Model:      cassetteEntry.Request.Model,
			Status:     status,
			RecordedAt: cassetteEntry.RecordedAt,
			HitCount:   1,
		})
	}
	return qualityCassetteSummary{
		Path:                 path,
		Mode:                 nonEmptyString(cassette.Mode, "record"),
		Status:               "matching",
		Coverage:             1,
		EntryCount:           len(cassette.Entries),
		MissingCount:         0,
		MismatchCount:        0,
		ProviderCallsAvoided: providerCallsAvoided,
		Boundaries:           boundaries,
		Matchers:             []string{"kind", "target", "provider", "model"},
		Entries:              entrySummaries,
		RecordedAt:           recordedAt,
		HitRate:              1,
	}, nil
}

func persistQualityCassetteIssue(dir string, req qualityCassetteIssueRecord) (qualityCassetteIssueRecord, error) {
	if req.Path == "" {
		return qualityCassetteIssueRecord{}, fmt.Errorf("path is required")
	}
	if req.Status != "missing" && req.Status != "mismatch" && req.Status != "recorded" && req.Status != "error" {
		return qualityCassetteIssueRecord{}, fmt.Errorf("status must be missing, mismatch, recorded, or error")
	}
	if req.EntryID == "" {
		req.EntryID = fmt.Sprintf("cassette-issue-%d", time.Now().UnixNano())
	}
	req.Tag = "QualityCassetteIssue"
	req.RecordedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := appendQualityJSONLine(filepath.Join(dir, "cassettes", "issues.jsonl"), req); err != nil {
		return qualityCassetteIssueRecord{}, err
	}
	return req, nil
}

func readQualityCassetteIssues(dir string) ([]qualityCassetteIssueRecord, error) {
	raw, err := readQualityJSONLines(filepath.Join(dir, "issues.jsonl"))
	if err != nil {
		return nil, err
	}
	issues := make([]qualityCassetteIssueRecord, 0, len(raw))
	for _, item := range raw {
		var record qualityCassetteIssueRecord
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		issues = append(issues, record)
	}
	return issues, nil
}

func applyQualityCassetteIssues(summaries []qualityCassetteSummary, issues []qualityCassetteIssueRecord) []qualityCassetteSummary {
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
			summaries = append(summaries, qualityCassetteSummary{
				Path:       issue.Path,
				Mode:       "replay",
				Status:     "matching",
				Coverage:   1,
				Boundaries: map[string]qualityCassetteBoundary{},
				Matchers:   []string{"kind", "target", "provider", "model"},
				Entries:    []qualityCassetteEntrySummary{},
			})
			index = len(summaries) - 1
			indexByPath[issue.Path] = index
			indexByPath[filepath.Base(issue.Path)] = index
		}

		summary := summaries[index]
		if summary.Boundaries == nil {
			summary.Boundaries = map[string]qualityCassetteBoundary{}
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

		entry := qualityCassetteEntrySummary{
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
		summary.Status = qualityCassetteStatus(summary)
		summary.Coverage = qualityCassetteCoverage(summary)
		summary.HitRate = qualityCassetteHitRate(summary)
		summaries[index] = summary
	}
	for index, summary := range summaries {
		summary.Status = qualityCassetteStatus(summary)
		summary.Coverage = qualityCassetteCoverage(summary)
		summary.HitRate = qualityCassetteHitRate(summary)
		summaries[index] = summary
	}
	return summaries
}

func qualityCassetteHitRate(summary qualityCassetteSummary) float64 {
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

func qualityCassetteStatus(summary qualityCassetteSummary) string {
	if summary.MismatchCount > 0 {
		return "mismatch"
	}
	if summary.MissingCount > 0 {
		return "missing"
	}
	return "matching"
}

func qualityCassetteCoverage(summary qualityCassetteSummary) float64 {
	total := summary.EntryCount + summary.MissingCount
	if total == 0 {
		return 1
	}
	return float64(summary.EntryCount-summary.MismatchCount) / float64(total)
}
