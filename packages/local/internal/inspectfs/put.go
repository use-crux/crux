package inspectfs

import (
	"fmt"
	"path/filepath"
	"time"
)

type Record interface {
	InsightStatus | InsightSilence
}

func Put[T Record](f *FS, record T) (T, error) {
	if f == nil {
		f = Open("")
	}
	var zero T
	switch value := any(record).(type) {
	case InsightStatus:
		written, err := f.putInsightStatus(value)
		if err != nil {
			return zero, err
		}
		return any(written).(T), nil
	case InsightSilence:
		written, err := f.putInsightSilence(value)
		if err != nil {
			return zero, err
		}
		return any(written).(T), nil
	default:
		return zero, fmt.Errorf("unsupported Inspect record %T", record)
	}
}

func (f *FS) putInsightStatus(record InsightStatus) (InsightStatus, error) {
	if record.InsightID == "" {
		return InsightStatus{}, fmt.Errorf("insightId is required")
	}
	if record.Status != "open" && record.Status != "dismissed" && record.Status != "resolved" {
		return InsightStatus{}, fmt.Errorf("status must be open, dismissed, or resolved")
	}
	if record.Tag == "" {
		record.Tag = "InspectInsightStatus"
	}
	if record.UpdatedAt == "" {
		record.UpdatedAt = nowString()
	}
	if record.Status == "resolved" && record.ResolvedAt == "" {
		record.ResolvedAt = record.UpdatedAt
	}
	return record, appendJSONLine(filepath.Join(f.dir, filepath.FromSlash(string(StreamInsightStatuses))), record)
}

func (f *FS) putInsightSilence(record InsightSilence) (InsightSilence, error) {
	pattern := normalizeInsightSilencePattern(record.Pattern)
	if pattern.Title == "" {
		return InsightSilence{}, fmt.Errorf("pattern.title is required")
	}
	record.Pattern = pattern
	if record.ID == "" {
		record.ID = InsightSilenceID(pattern)
	}
	if record.Tag == "" {
		record.Tag = "InspectInsightSilence"
	}
	if record.CreatedAt == "" {
		record.CreatedAt = nowString()
	}
	return record, appendJSONLine(filepath.Join(f.dir, filepath.FromSlash(string(StreamInsightSilences))), record)
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
