package qualityfs

import "encoding/json"

type Record interface {
	qualityRecord()
}

func (Suite) qualityRecord()              {}
func (Experiment) qualityRecord()         {}
func (Comparison) qualityRecord()         {}
func (Baseline) qualityRecord()           {}
func (Feedback) qualityRecord()           {}
func (FeedbackAnnotation) qualityRecord() {}
func (InsightStatus) qualityRecord()      {}
func (InsightSilence) qualityRecord()     {}
func (CassetteIssue) qualityRecord()      {}

func rawClone(value json.RawMessage) json.RawMessage {
	if value == nil {
		return nil
	}
	return append(json.RawMessage(nil), value...)
}
