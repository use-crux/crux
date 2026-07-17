package inspect

import (
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/inspectfs"
)

func persistInspectInsightStatus(dir, insightID string, req inspectInsightStatusRequest, resolvedOccurrences int) (inspectInsightStatusRecord, error) {
	record := inspectInsightStatusRecord{InsightID: insightID, Status: req.Status, Note: req.Note}
	if req.Status == "resolved" {
		record.ResolvedOccurrences = resolvedOccurrences
	}
	return inspectfs.Put(inspectfs.Open(dir), record)
}

func persistInspectInsightSilence(dir string, req inspectInsightSilenceRequest) (inspectInsightSilenceRecord, error) {
	if req.Pattern == nil {
		return inspectInsightSilenceRecord{}, fmt.Errorf("pattern is required")
	}
	pattern := inspectfs.NormalizeInsightSilencePattern(*req.Pattern)
	if pattern.Title == "" {
		return inspectInsightSilenceRecord{}, fmt.Errorf("pattern.title is required")
	}
	return inspectfs.Put(inspectfs.Open(dir), inspectInsightSilenceRecord{Pattern: pattern, Note: req.Note})
}

func inspectInsightSilences(dir string, includeDeleted bool) ([]inspectInsightSilenceRecord, error) {
	return inspectfs.Open(dir).ReadInsightSilences(includeDeleted)
}

func deleteInspectInsightSilence(dir, silenceID string) (inspectInsightSilenceRecord, error) {
	if silenceID == "" {
		return inspectInsightSilenceRecord{}, fmt.Errorf("silenceId is required")
	}
	silences, err := inspectInsightSilences(dir, true)
	if err != nil {
		return inspectInsightSilenceRecord{}, err
	}
	for _, existing := range silences {
		if existing.ID == silenceID && existing.DeletedAt == "" {
			existing.DeletedAt = time.Now().UTC().Format(time.RFC3339Nano)
			return inspectfs.Put(inspectfs.Open(dir), existing)
		}
	}
	return inspectInsightSilenceRecord{}, fmt.Errorf("inspect insight silence %q not found", silenceID)
}
