package qualityfs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (f *FS) readCassettes() ([]Cassette, error) {
	dir := filepath.Join(f.dir, "cassettes")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			issues, issueErr := f.readCassetteIssues()
			if issueErr != nil {
				return nil, issueErr
			}
			return applyCassetteIssues([]Cassette{}, issues), nil
		}
		return nil, err
	}
	summaries := []Cassette{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		if entry.Name() == "issues.json" {
			continue
		}
		summary, ok, err := readCassetteFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		if !ok {
			// Not a legacy workbench cassette — the engine's executor
			// cassettes (`entries` keyed by call hash) share this directory
			// and are served by ReadCassetteFiles instead. A foreign file
			// must never poison the legacy snapshot.
			continue
		}
		summaries = append(summaries, summary)
	}
	issues, err := f.readCassetteIssues()
	if err != nil {
		return nil, err
	}
	return applyCassetteIssues(summaries, issues), nil
}

func (f *FS) readCassettesForProject(projectRoot string) ([]Cassette, error) {
	workbench, err := f.readCassettes()
	if err != nil {
		return nil, err
	}
	paths, err := discoverProjectCassettePaths(projectRoot)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	summaries := make([]Cassette, 0, len(workbench)+len(paths))
	for _, summary := range workbench {
		seen[summary.Path] = struct{}{}
		summaries = append(summaries, summary)
	}
	for _, path := range paths {
		if _, exists := seen[path]; exists {
			continue
		}
		summary, ok, err := readCassetteFile(path)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		summaries = append(summaries, summary)
	}
	sort.SliceStable(summaries, func(i, j int) bool {
		return summaries[i].Path < summaries[j].Path
	})
	return summaries, nil
}

// readCassetteFile parses one legacy workbench cassette. The boolean is
// false when the file is not in the legacy format (e.g. a spec-02-era
// executor cassette, whose `entries` is an object keyed by call hash, not
// an array) — such files are skipped, never an error: a single foreign
// file used to fail the whole Snapshot and 500 every legacy read model.
func readCassetteFile(path string) (Cassette, bool, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Cassette{}, false, err
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
		return Cassette{}, false, nil
	}
	recordedAt := ""
	boundaries := map[string]CassetteBoundary{}
	entries := make([]CassetteEntry, 0, len(cassette.Entries))
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
		entries = append(entries, CassetteEntry{
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
	return Cassette{
		Path:                 path,
		Mode:                 nonEmptyString(cassette.Mode, "record"),
		Status:               "matching",
		Coverage:             1,
		EntryCount:           len(cassette.Entries),
		ProviderCallsAvoided: providerCallsAvoided,
		Boundaries:           boundaries,
		Matchers:             []string{"kind", "target", "provider", "model"},
		Entries:              entries,
		RecordedAt:           recordedAt,
		HitRate:              1,
	}, true, nil
}
