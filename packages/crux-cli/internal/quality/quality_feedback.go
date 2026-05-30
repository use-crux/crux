package quality

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"
)

func readQualityFeedbackRecords(dir string) ([]qualityFeedbackRecord, error) {
	raw, err := readQualityJSONLines(filepath.Join(dir, "feedback", "inbox.jsonl"))
	if err != nil {
		return nil, err
	}
	annotations, err := readQualityFeedbackAnnotations(dir)
	if err != nil {
		return nil, err
	}
	feedback := make([]qualityFeedbackRecord, 0, len(raw))
	for _, item := range raw {
		var record qualityFeedbackRecord
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		if annotation, ok := annotations[record.ID]; ok {
			if annotation.Status != "" {
				record.Status = annotation.Status
			}
			if annotation.Expected != nil {
				record.Expected = annotation.Expected
			}
			if len(annotation.Tags) > 0 {
				record.Tags = appendUniqueStrings(record.Tags, annotation.Tags...)
			}
			if annotation.Metadata != nil {
				if record.Metadata == nil {
					record.Metadata = map[string]interface{}{}
				}
				for key, value := range annotation.Metadata {
					record.Metadata[key] = value
				}
			}
		}
		feedback = append(feedback, record)
	}
	return feedback, nil
}

func readQualityFeedbackAnnotations(dir string) (map[string]qualityFeedbackAnnotationRecord, error) {
	raw, err := readQualityJSONLines(filepath.Join(dir, "feedback", "annotations.jsonl"))
	if err != nil {
		return nil, err
	}
	annotations := map[string]qualityFeedbackAnnotationRecord{}
	for _, item := range raw {
		var record qualityFeedbackAnnotationRecord
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		if record.FeedbackID != "" {
			annotations[record.FeedbackID] = record
		}
	}
	return annotations, nil
}

type qualityFeedbackPostRequest struct {
	TraceID      *string                `json:"traceId,omitempty"`
	ExperimentID *string                `json:"experimentId,omitempty"`
	CaseID       *string                `json:"caseId,omitempty"`
	Rating       *int                   `json:"rating,omitempty"`
	Comment      *string                `json:"comment,omitempty"`
	Expected     map[string]interface{} `json:"expected,omitempty"`
	Tags         []string               `json:"tags,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

type qualityFeedbackRecord struct {
	Tag          string                 `json:"_tag"`
	ID           string                 `json:"id"`
	QualityID    string                 `json:"qualityId"`
	CreatedAt    string                 `json:"createdAt"`
	Status       string                 `json:"status"`
	TraceID      *string                `json:"traceId,omitempty"`
	ExperimentID *string                `json:"experimentId,omitempty"`
	CaseID       *string                `json:"caseId,omitempty"`
	Rating       *int                   `json:"rating,omitempty"`
	Comment      *string                `json:"comment,omitempty"`
	Expected     map[string]interface{} `json:"expected,omitempty"`
	Tags         []string               `json:"tags,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

type qualityFeedbackAnnotationPostRequest struct {
	FeedbackID string                 `json:"feedbackId"`
	Status     string                 `json:"status,omitempty"`
	Note       *string                `json:"note,omitempty"`
	Expected   map[string]interface{} `json:"expected,omitempty"`
	Tags       []string               `json:"tags,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

type qualityFeedbackAnnotationRecord struct {
	Tag        string                 `json:"_tag"`
	ID         string                 `json:"id"`
	QualityID  string                 `json:"qualityId"`
	FeedbackID string                 `json:"feedbackId"`
	CreatedAt  string                 `json:"createdAt"`
	Status     string                 `json:"status,omitempty"`
	Note       *string                `json:"note,omitempty"`
	Expected   map[string]interface{} `json:"expected,omitempty"`
	Tags       []string               `json:"tags,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

func createQualityFeedbackAnnotation(dir string, req qualityFeedbackAnnotationPostRequest) (qualityFeedbackAnnotationRecord, error) {
	if req.FeedbackID == "" {
		return qualityFeedbackAnnotationRecord{}, fmt.Errorf("feedbackId is required")
	}
	record := qualityFeedbackAnnotationRecord{
		Tag:        "QualityFeedbackAnnotation",
		ID:         fmt.Sprintf("feedback-annotation-%d", time.Now().UnixNano()),
		QualityID:  "local",
		FeedbackID: req.FeedbackID,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Status:     req.Status,
		Note:       req.Note,
		Expected:   req.Expected,
		Tags:       req.Tags,
		Metadata:   req.Metadata,
	}
	if err := appendQualityJSONLine(filepath.Join(dir, "feedback", "annotations.jsonl"), record); err != nil {
		return qualityFeedbackAnnotationRecord{}, err
	}
	return record, nil
}
