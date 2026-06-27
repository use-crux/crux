package protocol

import (
	"encoding/json"
	"fmt"
)

type AnalyzeStreamHandler func(AnalyzeStreamEvent) error

type AnalyzeStreamEvent struct {
	ID                    uint64            `json:"id"`
	OK                    bool              `json:"ok"`
	Type                  string            `json:"type,omitempty"`
	Fact                  json.RawMessage   `json:"fact,omitempty"`
	Facts                 []json.RawMessage `json:"facts,omitempty"`
	Diagnostics           []json.RawMessage `json:"diagnostics,omitempty"`
	ExtensionEvidenceJobs []json.RawMessage `json:"extensionEvidenceJobs,omitempty"`
	Response              *AnalyzeResponse  `json:"response,omitempty"`
	Error                 string            `json:"error,omitempty"`
}

type FinalizeStreamHandler func(FinalizeStreamEvent) error

type FinalizeStreamEvent struct {
	ID       uint64            `json:"id"`
	OK       bool              `json:"ok"`
	Type     string            `json:"type,omitempty"`
	Event    json.RawMessage   `json:"event,omitempty"`
	Response *FinalizeResponse `json:"response,omitempty"`
	Error    string            `json:"error,omitempty"`
}

func DecodeAnalyzeStreamEvent(raw json.RawMessage) (AnalyzeStreamEvent, error) {
	var event AnalyzeStreamEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return AnalyzeStreamEvent{}, fmt.Errorf("decode Static Index analyze stream event: %w", err)
	}
	return event, nil
}

func DecodeFinalizeStreamEvent(raw json.RawMessage) (FinalizeStreamEvent, error) {
	var event FinalizeStreamEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return FinalizeStreamEvent{}, fmt.Errorf("decode Static Index finalize stream event: %w", err)
	}
	return event, nil
}

func AnalyzeStreamError(message string) error {
	if message == "" {
		return fmt.Errorf("Static Index analyze stream failed")
	}
	return fmt.Errorf("Static Index analyze stream failed: %s", message)
}

func FinalizeStreamError(message string) error {
	if message == "" {
		return fmt.Errorf("Static Index finalize stream failed")
	}
	return fmt.Errorf("Static Index finalize stream failed: %s", message)
}

func AppendRawMessage(values []json.RawMessage, value json.RawMessage) []json.RawMessage {
	if len(value) == 0 {
		return values
	}
	return append(values, append(json.RawMessage(nil), value...))
}

func AppendRawMessages(values []json.RawMessage, next []json.RawMessage) []json.RawMessage {
	for _, value := range next {
		values = AppendRawMessage(values, value)
	}
	return values
}
