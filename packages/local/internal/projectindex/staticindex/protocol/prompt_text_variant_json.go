package protocol

import (
	"encoding/json"
	"fmt"
)

// MarshalJSON preserves the fields owned by the selected Rust enum variant,
// including required false, zero, empty-array, and null values.
func (b PromptTextBlock) MarshalJSON() ([]byte, error) {
	payload := map[string]any{
		"kind": b.Kind, "index": b.Index, "island": b.Island, "range": b.Range,
	}
	switch b.Kind {
	case PromptTextBlockHeading:
		if b.Level < 1 || b.Level > 6 {
			return nil, fmt.Errorf("marshal PromptText heading with invalid level %d", b.Level)
		}
		if b.Label == nil || *b.Label == "" {
			return nil, fmt.Errorf("marshal PromptText heading without required label")
		}
		payload["level"] = b.Level
		payload["label"] = *b.Label
		if err := addRequiredRange(payload, "textRange", b.TextRange); err != nil {
			return nil, err
		}
	case PromptTextBlockParagraph, PromptTextBlockThematicBreak, PromptTextBlockHTML:
	case PromptTextBlockBlockquote:
		markerRanges := b.MarkerRanges
		if markerRanges == nil {
			markerRanges = []PromptTextRange{}
		}
		payload["markerRanges"] = markerRanges
	case PromptTextBlockList:
		payload["ordered"] = b.Ordered
		payload["start"] = b.Start
	case PromptTextBlockListItem:
		if err := addRequiredRange(payload, "markerRange", b.MarkerRange); err != nil {
			return nil, err
		}
	case PromptTextBlockCode:
		if err := addRequiredRange(payload, "contentRange", b.ContentRange); err != nil {
			return nil, err
		}
		payload["fenced"] = b.Fenced
		payload["info"] = b.Info
	default:
		return nil, fmt.Errorf("marshal PromptText block with unknown kind %q", b.Kind)
	}
	return json.Marshal(payload)
}

// MarshalJSON preserves required nullable fields on the selected Rust link
// variant while omitting fields owned by the other variant.
func (l PromptTextLink) MarshalJSON() ([]byte, error) {
	payload := map[string]any{
		"kind": l.Kind, "index": l.Index, "island": l.Island,
		"range": l.Range, "textRange": l.TextRange, "destination": l.Destination,
	}
	switch l.Kind {
	case PromptTextLinkInline:
		if err := addRequiredRange(payload, "destinationRange", l.DestinationRange); err != nil {
			return nil, err
		}
		payload["title"] = l.Title
	case PromptTextLinkAutolink:
	default:
		return nil, fmt.Errorf("marshal PromptText link with unknown kind %q", l.Kind)
	}
	return json.Marshal(payload)
}

// MarshalJSON preserves required zero and empty-string fields on the selected
// Rust preview-segment variant.
func (s PromptTextPreviewSegment) MarshalJSON() ([]byte, error) {
	payload := map[string]any{"kind": s.Kind, "text": s.Text}
	switch s.Kind {
	case PromptTextPreviewAuthoredLiteral:
		if err := addRequiredRange(payload, "range", s.Range); err != nil {
			return nil, err
		}
	case PromptTextPreviewKnownValue, PromptTextPreviewPlaceholder:
		payload["interpolation"] = s.Interpolation
	case PromptTextPreviewFragment:
		payload["fragmentId"] = s.FragmentID
		payload["sourceHash"] = s.SourceHash
	case PromptTextPreviewTruncation:
	default:
		return nil, fmt.Errorf("marshal PromptText preview segment with unknown kind %q", s.Kind)
	}
	return json.Marshal(payload)
}

func addRequiredRange(payload map[string]any, field string, value *PromptTextRange) error {
	if value == nil {
		return fmt.Errorf("marshal PromptText variant without required %s", field)
	}
	payload[field] = *value
	return nil
}
