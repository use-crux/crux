package qualityfs

import (
	"fmt"
	"path/filepath"
	"time"
)

func Put[T Record](f *FS, rec T) (T, error) {
	if f == nil {
		f = Open("")
	}
	var zero T
	switch record := any(rec).(type) {
	case Suite:
		out, err := f.putSuite(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case Experiment:
		out, err := f.putExperiment(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case Comparison:
		out, err := f.putComparison(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case Baseline:
		out, err := f.putBaseline(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case Feedback:
		out, err := f.putFeedback(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case FeedbackAnnotation:
		out, err := f.putFeedbackAnnotation(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case InsightStatus:
		out, err := f.putInsightStatus(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case InsightSilence:
		out, err := f.putInsightSilence(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	case CassetteIssue:
		out, err := f.putCassetteIssue(record)
		if err != nil {
			return zero, err
		}
		return any(out).(T), nil
	default:
		return zero, fmt.Errorf("unsupported quality record %T", rec)
	}
}

func (f *FS) putSuite(record Suite) (Suite, error) {
	record = normalizeSuite(record)
	if record.SuiteID == "" {
		return Suite{}, fmt.Errorf("suiteId is required")
	}
	return record, f.writeRecord(KindSuites, record.SuiteID, record)
}

func (f *FS) putExperiment(record Experiment) (Experiment, error) {
	if record.ID == "" {
		record.ID = fmt.Sprintf("experiment-%d", time.Now().UnixNano())
	}
	if record.Tag == "" {
		record.Tag = "QualityExperiment"
	}
	if record.QualityID == "" {
		record.QualityID = "local"
	}
	return record, f.writeRecord(KindExperiments, record.ID, record)
}

func (f *FS) putComparison(record Comparison) (Comparison, error) {
	if record.ID == "" {
		return Comparison{}, fmt.Errorf("id is required")
	}
	if record.Tag == "" {
		record.Tag = "QualityComparison"
	}
	if record.QualityID == "" {
		record.QualityID = "local"
	}
	if record.ComparedAt == "" {
		record.ComparedAt = nowString()
	}
	if record.Status == "" {
		record.Status = "ready"
	}
	return record, f.writeRecord(KindComparisons, record.ID, record)
}

func (f *FS) putBaseline(record Baseline) (Baseline, error) {
	if record.ID == "" {
		return Baseline{}, fmt.Errorf("id is required")
	}
	if record.Tag == "" {
		record.Tag = "QualityBaseline"
	}
	if record.QualityID == "" {
		record.QualityID = "local"
	}
	if record.PromotedAt == "" {
		record.PromotedAt = nowString()
	}
	return record, f.writeRecord(KindBaselines, record.ID, record)
}

func (f *FS) putFeedback(record Feedback) (Feedback, error) {
	if record.ID == "" {
		record.ID = fmt.Sprintf("feedback-%d", time.Now().UnixNano())
	}
	if record.Tag == "" {
		record.Tag = "QualityFeedback"
	}
	if record.QualityID == "" {
		record.QualityID = "local"
	}
	if record.CreatedAt == "" {
		record.CreatedAt = nowString()
	}
	if record.Status == "" {
		record.Status = "new"
	}
	return record, appendJSONLine(filepath.Join(f.dir, filepath.FromSlash(string(StreamFeedbackInbox))), record)
}

func (f *FS) putFeedbackAnnotation(record FeedbackAnnotation) (FeedbackAnnotation, error) {
	if record.FeedbackID == "" {
		return FeedbackAnnotation{}, fmt.Errorf("feedbackId is required")
	}
	if record.ID == "" {
		record.ID = fmt.Sprintf("feedback-annotation-%d", time.Now().UnixNano())
	}
	if record.Tag == "" {
		record.Tag = "QualityFeedbackAnnotation"
	}
	if record.QualityID == "" {
		record.QualityID = "local"
	}
	if record.CreatedAt == "" {
		record.CreatedAt = nowString()
	}
	return record, appendJSONLine(filepath.Join(f.dir, filepath.FromSlash(string(StreamFeedbackAnnotations))), record)
}

func (f *FS) putInsightStatus(record InsightStatus) (InsightStatus, error) {
	if record.InsightID == "" {
		return InsightStatus{}, fmt.Errorf("insightId is required")
	}
	if record.Status != "open" && record.Status != "dismissed" && record.Status != "resolved" {
		return InsightStatus{}, fmt.Errorf("status must be open, dismissed, or resolved")
	}
	if record.Tag == "" {
		record.Tag = "QualityInsightStatus"
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
		record.Tag = "QualityInsightSilence"
	}
	if record.CreatedAt == "" {
		record.CreatedAt = nowString()
	}
	return record, appendJSONLine(filepath.Join(f.dir, filepath.FromSlash(string(StreamInsightSilences))), record)
}

func (f *FS) putCassetteIssue(record CassetteIssue) (CassetteIssue, error) {
	if record.Path == "" {
		return CassetteIssue{}, fmt.Errorf("path is required")
	}
	if record.Status != "missing" && record.Status != "mismatch" && record.Status != "recorded" && record.Status != "error" {
		return CassetteIssue{}, fmt.Errorf("status must be missing, mismatch, recorded, or error")
	}
	if record.EntryID == "" {
		record.EntryID = fmt.Sprintf("cassette-issue-%d", time.Now().UnixNano())
	}
	if record.Tag == "" {
		record.Tag = "QualityCassetteIssue"
	}
	if record.RecordedAt == "" {
		record.RecordedAt = nowString()
	}
	return record, appendJSONLine(filepath.Join(f.dir, filepath.FromSlash(string(StreamCassetteIssues))), record)
}
