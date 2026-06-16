package qualityfs

import (
	"encoding/json"
	"path/filepath"
)

func (f *FS) readFeedback() ([]Feedback, error) {
	raw, err := readJSONLines(filepath.Join(f.dir, filepath.FromSlash(string(StreamFeedbackInbox))))
	if err != nil {
		return nil, err
	}
	annotations, err := f.readFeedbackAnnotations()
	if err != nil {
		return nil, err
	}
	records := make([]Feedback, 0, len(raw))
	for _, item := range raw {
		var record Feedback
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		for _, annotation := range annotations[record.ID] {
			record = applyFeedbackAnnotation(record, annotation)
		}
		records = append(records, record)
	}
	return records, nil
}

// readFeedbackAnnotations groups annotations per feedback ID in stream order,
// so every incremental annotation is applied instead of only the last one.
func (f *FS) readFeedbackAnnotations() (map[string][]FeedbackAnnotation, error) {
	raw, err := readJSONLines(filepath.Join(f.dir, filepath.FromSlash(string(StreamFeedbackAnnotations))))
	if err != nil {
		return nil, err
	}
	records := map[string][]FeedbackAnnotation{}
	for _, item := range raw {
		var record FeedbackAnnotation
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		if record.FeedbackID != "" {
			records[record.FeedbackID] = append(records[record.FeedbackID], record)
		}
	}
	return records, nil
}

func applyFeedbackAnnotation(record Feedback, annotation FeedbackAnnotation) Feedback {
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
			record.Metadata = map[string]any{}
		}
		for key, value := range annotation.Metadata {
			record.Metadata[key] = value
		}
	}
	return record
}
