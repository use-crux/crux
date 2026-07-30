package protocol

import (
	"encoding/json"
	"fmt"
)

type promptTextBlockJSON struct {
	Kind   PromptTextBlockKind `json:"kind"`
	Index  *uint32             `json:"index"`
	Island *uint32             `json:"island"`
	Range  *PromptTextRange    `json:"range"`
}

func (b *PromptTextBlock) UnmarshalJSON(data []byte) error {
	kind, err := promptTextVariantKind(data)
	if err != nil {
		return err
	}
	var decoded PromptTextBlock
	switch PromptTextBlockKind(kind) {
	case PromptTextBlockHeading:
		var value struct {
			promptTextBlockJSON
			Level     *uint8           `json:"level"`
			Label     *string          `json:"label"`
			TextRange *PromptTextRange `json:"textRange"`
		}
		if err := decodeClosedPromptTextVariant(data, &value); err != nil {
			return err
		}
		decoded, err = decodedPromptTextBlock(value.promptTextBlockJSON)
		if err == nil {
			decoded.Level, err = requiredPromptTextField(value.Level, "level")
		}
		if err == nil {
			decoded.Label, err = requiredPromptTextFieldPointer(value.Label, "label")
		}
		if err == nil {
			decoded.TextRange, err = requiredPromptTextFieldPointer(value.TextRange, "textRange")
		}
	case PromptTextBlockParagraph, PromptTextBlockThematicBreak, PromptTextBlockHTML:
		var value promptTextBlockJSON
		err = decodeClosedPromptTextVariant(data, &value)
		if err == nil {
			decoded, err = decodedPromptTextBlock(value)
		}
	case PromptTextBlockBlockquote:
		var value struct {
			promptTextBlockJSON
			MarkerRanges []PromptTextRange `json:"markerRanges"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded, err = decodedPromptTextBlock(value.promptTextBlockJSON)
		}
		if err == nil && value.MarkerRanges == nil {
			err = fmt.Errorf("missing required PromptText field %q", "markerRanges")
		}
		decoded.MarkerRanges = value.MarkerRanges
	case PromptTextBlockList:
		var value struct {
			promptTextBlockJSON
			Ordered *bool           `json:"ordered"`
			Start   json.RawMessage `json:"start"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded, err = decodedPromptTextBlock(value.promptTextBlockJSON)
		}
		if err == nil {
			decoded.Ordered, err = requiredPromptTextField(value.Ordered, "ordered")
		}
		if err == nil {
			decoded.Start, err = decodeRequiredNullable[uint64](value.Start, "start")
		}
	case PromptTextBlockListItem:
		var value struct {
			promptTextBlockJSON
			MarkerRange *PromptTextRange `json:"markerRange"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded, err = decodedPromptTextBlock(value.promptTextBlockJSON)
		}
		if err == nil {
			decoded.MarkerRange, err = requiredPromptTextFieldPointer(
				value.MarkerRange, "markerRange",
			)
		}
	case PromptTextBlockCode:
		var value struct {
			promptTextBlockJSON
			ContentRange *PromptTextRange `json:"contentRange"`
			Fenced       *bool            `json:"fenced"`
			Info         json.RawMessage  `json:"info"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded, err = decodedPromptTextBlock(value.promptTextBlockJSON)
		}
		if err == nil {
			decoded.ContentRange, err = requiredPromptTextFieldPointer(
				value.ContentRange, "contentRange",
			)
		}
		if err == nil {
			decoded.Fenced, err = requiredPromptTextField(value.Fenced, "fenced")
		}
		if err == nil {
			decoded.Info, err = decodeRequiredNullable[string](value.Info, "info")
		}
	default:
		return fmt.Errorf("unknown PromptText block kind %q", kind)
	}
	if err != nil {
		return err
	}
	*b = decoded
	return nil
}

func decodedPromptTextBlock(value promptTextBlockJSON) (PromptTextBlock, error) {
	index, err := requiredPromptTextField(value.Index, "index")
	if err != nil {
		return PromptTextBlock{}, err
	}
	island, err := requiredPromptTextField(value.Island, "island")
	if err != nil {
		return PromptTextBlock{}, err
	}
	sourceRange, err := requiredPromptTextField(value.Range, "range")
	if err != nil {
		return PromptTextBlock{}, err
	}
	return PromptTextBlock{
		Kind: value.Kind, Index: index, Island: island, Range: sourceRange,
	}, nil
}

func requiredPromptTextFieldPointer[T any](value *T, name string) (*T, error) {
	if value == nil {
		return nil, fmt.Errorf("missing required PromptText field %q", name)
	}
	return value, nil
}
