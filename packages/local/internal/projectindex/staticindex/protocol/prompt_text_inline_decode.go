package protocol

import (
	"encoding/json"
	"fmt"
)

type promptTextInlineJSON struct {
	Kind   string           `json:"kind"`
	Index  *uint32          `json:"index"`
	Island *uint32          `json:"island"`
	Range  *PromptTextRange `json:"range"`
}

func (s *PromptTextSpan) UnmarshalJSON(data []byte) error {
	kind, err := promptTextVariantKind(data)
	if err != nil {
		return err
	}
	var span PromptTextSpan
	switch PromptTextSpanKind(kind) {
	case PromptTextSpanEmphasis, PromptTextSpanStrong, PromptTextSpanInlineCode:
		var value struct {
			promptTextInlineJSON
			TextRange *PromptTextRange `json:"textRange"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			var decoded promptTextInlineJSON
			decoded, err = decodedPromptTextInline(value.promptTextInlineJSON)
			if err == nil {
				span = PromptTextSpan{
					Kind: PromptTextSpanKind(kind), Index: *decoded.Index,
					Island: *decoded.Island, Range: *decoded.Range,
				}
				span.TextRange, err = requiredPromptTextFieldPointer(
					value.TextRange, "textRange",
				)
			}
		}
	case PromptTextSpanHTML, PromptTextSpanSoftBreak, PromptTextSpanHardBreak:
		var value promptTextInlineJSON
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			var decoded promptTextInlineJSON
			decoded, err = decodedPromptTextInline(value)
			if err == nil {
				span = PromptTextSpan{
					Kind: PromptTextSpanKind(kind), Index: *decoded.Index,
					Island: *decoded.Island, Range: *decoded.Range,
				}
			}
		}
	default:
		return fmt.Errorf("unknown PromptText span kind %q", kind)
	}
	if err != nil {
		return err
	}
	*s = span
	return nil
}

func (l *PromptTextLink) UnmarshalJSON(data []byte) error {
	kind, err := promptTextVariantKind(data)
	if err != nil {
		return err
	}
	var decoded PromptTextLink
	switch PromptTextLinkKind(kind) {
	case PromptTextLinkInline:
		var value struct {
			promptTextInlineJSON
			TextRange        *PromptTextRange `json:"textRange"`
			DestinationRange *PromptTextRange `json:"destinationRange"`
			Destination      *string          `json:"destination"`
			Title            json.RawMessage  `json:"title"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded, err = decodedPromptTextLink(value.promptTextInlineJSON)
		}
		if err == nil {
			decoded.TextRange, err = requiredPromptTextField(
				value.TextRange, "textRange",
			)
		}
		if err == nil {
			decoded.DestinationRange, err = requiredPromptTextFieldPointer(
				value.DestinationRange, "destinationRange",
			)
		}
		if err == nil {
			decoded.Destination, err = requiredPromptTextField(
				value.Destination, "destination",
			)
		}
		if err == nil {
			decoded.Title, err = decodeRequiredNullable[string](value.Title, "title")
		}
	case PromptTextLinkAutolink:
		var value struct {
			promptTextInlineJSON
			TextRange   *PromptTextRange `json:"textRange"`
			Destination *string          `json:"destination"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded, err = decodedPromptTextLink(value.promptTextInlineJSON)
		}
		if err == nil {
			decoded.TextRange, err = requiredPromptTextField(
				value.TextRange, "textRange",
			)
		}
		if err == nil {
			decoded.Destination, err = requiredPromptTextField(
				value.Destination, "destination",
			)
		}
	default:
		return fmt.Errorf("unknown PromptText link kind %q", kind)
	}
	if err != nil {
		return err
	}
	*l = decoded
	return nil
}

func (n *PromptTextNodeRef) UnmarshalJSON(data []byte) error {
	var value struct {
		Kind  PromptTextNodeKind `json:"kind"`
		Index *uint32            `json:"index"`
	}
	if err := decodeClosedPromptTextVariant(data, &value); err != nil {
		return err
	}
	switch value.Kind {
	case PromptTextNodeBlock, PromptTextNodeSpan, PromptTextNodeLink:
	default:
		return fmt.Errorf("unknown PromptText node kind %q", value.Kind)
	}
	index, err := requiredPromptTextField(value.Index, "index")
	if err != nil {
		return err
	}
	*n = PromptTextNodeRef{Kind: value.Kind, Index: index}
	return nil
}

func decodedPromptTextInline(
	value promptTextInlineJSON,
) (promptTextInlineJSON, error) {
	index, err := requiredPromptTextField(value.Index, "index")
	if err != nil {
		return promptTextInlineJSON{}, err
	}
	island, err := requiredPromptTextField(value.Island, "island")
	if err != nil {
		return promptTextInlineJSON{}, err
	}
	sourceRange, err := requiredPromptTextField(value.Range, "range")
	if err != nil {
		return promptTextInlineJSON{}, err
	}
	value.Index, value.Island, value.Range = &index, &island, &sourceRange
	return value, nil
}

func decodedPromptTextLink(value promptTextInlineJSON) (PromptTextLink, error) {
	value, err := decodedPromptTextInline(value)
	if err != nil {
		return PromptTextLink{}, err
	}
	return PromptTextLink{
		Kind: PromptTextLinkKind(value.Kind), Index: *value.Index,
		Island: *value.Island, Range: *value.Range,
	}, nil
}
