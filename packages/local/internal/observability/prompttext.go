package observability

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"strings"
)

const (
	maxPromptTextSegments   = 200
	maxPromptTextTokenCount = 1<<53 - 1
)

type RunDetailPromptTextSegment struct {
	Text          string   `json:"text"`
	Dynamic       bool     `json:"dynamic"`
	Source        string   `json:"source,omitempty"`
	ObservedAt    *float64 `json:"observedAt,omitempty"`
	SourceVersion string   `json:"sourceVersion,omitempty"`
}

type RunDetailPromptTextUserPrompt struct {
	Kind          string                       `json:"kind"`
	Text          string                       `json:"text"`
	Segments      []RunDetailPromptTextSegment `json:"segments"`
	Tokens        float64                      `json:"tokens"`
	StaticTokens  float64                      `json:"staticTokens"`
	DynamicTokens float64                      `json:"dynamicTokens"`
}

type promptTextUserPromptWire struct {
	Kind          *string                  `json:"kind"`
	Text          *string                  `json:"text"`
	Segments      *[]promptTextSegmentWire `json:"segments"`
	Tokens        *float64                 `json:"tokens"`
	StaticTokens  *float64                 `json:"staticTokens"`
	DynamicTokens *float64                 `json:"dynamicTokens"`
}

type promptTextSegmentWire struct {
	Text          *string  `json:"text"`
	Dynamic       *bool    `json:"dynamic"`
	Source        *string  `json:"source,omitempty"`
	ObservedAt    *float64 `json:"observedAt,omitempty"`
	SourceVersion *string  `json:"sourceVersion,omitempty"`
}

// decodePromptTextUserPrompt validates the closed persisted preview and rejects
// any record whose segments cannot reconstruct the exact resolved prompt.
func decodePromptTextUserPrompt(raw json.RawMessage) *RunDetailPromptTextUserPrompt {
	if len(raw) == 0 {
		return nil
	}
	var wire promptTextUserPromptWire
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return nil
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil
	}
	if wire.Kind == nil || *wire.Kind != "prompt-text" ||
		wire.Text == nil || wire.Segments == nil ||
		wire.Tokens == nil || wire.StaticTokens == nil ||
		wire.DynamicTokens == nil ||
		!validPromptTextTokenCount(*wire.Tokens) ||
		!validPromptTextTokenCount(*wire.StaticTokens) ||
		!validPromptTextTokenCount(*wire.DynamicTokens) ||
		len(*wire.Segments) == 0 ||
		len(*wire.Segments) > maxPromptTextSegments {
		return nil
	}

	segments := make([]RunDetailPromptTextSegment, 0, len(*wire.Segments))
	var reconstructed strings.Builder
	for _, segment := range *wire.Segments {
		if segment.Text == nil || segment.Dynamic == nil ||
			(segment.ObservedAt != nil &&
				(math.IsNaN(*segment.ObservedAt) ||
					math.IsInf(*segment.ObservedAt, 0))) {
			return nil
		}
		reconstructed.WriteString(*segment.Text)
		projected := RunDetailPromptTextSegment{
			Text:       *segment.Text,
			Dynamic:    *segment.Dynamic,
			ObservedAt: segment.ObservedAt,
		}
		if segment.Source != nil {
			projected.Source = *segment.Source
		}
		if segment.SourceVersion != nil {
			projected.SourceVersion = *segment.SourceVersion
		}
		segments = append(segments, projected)
	}
	if reconstructed.String() != *wire.Text {
		return nil
	}
	return &RunDetailPromptTextUserPrompt{
		Kind:          *wire.Kind,
		Text:          *wire.Text,
		Segments:      segments,
		Tokens:        *wire.Tokens,
		StaticTokens:  *wire.StaticTokens,
		DynamicTokens: *wire.DynamicTokens,
	}
}

func promptTextPlainFallback(raw json.RawMessage) json.RawMessage {
	text := jsonRawString(jsonObjectFields(raw)["text"])
	if text == "" {
		return nil
	}
	encoded, err := json.Marshal(text)
	if err != nil {
		return nil
	}
	return encoded
}

func validPromptTextTokenCount(value float64) bool {
	return value >= 0 &&
		value <= maxPromptTextTokenCount &&
		!math.IsNaN(value) &&
		!math.IsInf(value, 0) &&
		math.Trunc(value) == value
}
