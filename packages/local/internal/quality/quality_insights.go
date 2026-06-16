package quality

import (
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

func buildQualityInsightsFromRuns(dir string, runs []qualityRunRecord) ([]qualityInsightRecord, error) {
	fs := qualityfs.Open(dir)
	specExperiments, _, err := fs.ReadExperimentRecords()
	if err != nil {
		return nil, err
	}
	return buildQualityInsightsFromInputs(fs, runs, specExperiments, time.Now().UTC())
}

func buildQualityInsightsFromInputs(fs *qualityfs.FS, runs []qualityRunRecord, specExperiments []qualityfs.ExperimentRecordFile, now time.Time) ([]qualityInsightRecord, error) {
	snapshot, err := fs.Snapshot()
	if err != nil {
		return nil, err
	}
	return deriveInsights(qualityInsightInputs{
		Quality:         snapshot,
		SpecExperiments: specExperiments,
		Runs:            runs,
		Now:             now.UTC(),
	}), nil
}

func persistQualityInsightStatus(dir string, insightID string, req qualityInsightStatusRequest, resolvedOccurrences int) (qualityInsightStatusRecord, error) {
	record := qualityInsightStatusRecord{
		InsightID: insightID,
		Status:    req.Status,
		Note:      req.Note,
	}
	if req.Status == "resolved" {
		record.ResolvedOccurrences = resolvedOccurrences
	}
	return qualityfs.Put(qualityfs.Open(dir), record)
}

func persistQualityInsightSilence(dir string, req qualityInsightSilenceRequest) (qualityInsightSilenceRecord, error) {
	if req.Pattern == nil {
		return qualityInsightSilenceRecord{}, fmt.Errorf("pattern is required")
	}
	pattern := qualityfs.NormalizeInsightSilencePattern(*req.Pattern)
	if pattern.Title == "" {
		return qualityInsightSilenceRecord{}, fmt.Errorf("pattern.title is required")
	}
	record := qualityInsightSilenceRecord{
		Pattern: pattern,
		Note:    req.Note,
	}
	return qualityfs.Put(qualityfs.Open(dir), record)
}

func qualityInsightSilences(dir string, includeDeleted bool) ([]qualityInsightSilenceRecord, error) {
	snapshot, err := qualityfs.Open(dir).Snapshot()
	if err != nil {
		return nil, err
	}
	out := make([]qualityInsightSilenceRecord, 0, len(snapshot.Silences))
	for _, record := range snapshot.Silences {
		if !includeDeleted && record.DeletedAt != "" {
			continue
		}
		out = append(out, record)
	}
	return out, nil
}

func deleteQualityInsightSilence(dir string, silenceID string) (qualityInsightSilenceRecord, error) {
	if silenceID == "" {
		return qualityInsightSilenceRecord{}, fmt.Errorf("silenceId is required")
	}
	silences, err := qualityInsightSilences(dir, true)
	if err != nil {
		return qualityInsightSilenceRecord{}, err
	}
	var existing *qualityInsightSilenceRecord
	for index := range silences {
		if silences[index].ID == silenceID {
			existing = &silences[index]
		}
	}
	if existing == nil || existing.DeletedAt != "" {
		return qualityInsightSilenceRecord{}, fmt.Errorf("quality insight silence %q not found", silenceID)
	}
	record := *existing
	record.DeletedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return qualityfs.Put(qualityfs.Open(dir), record)
}
