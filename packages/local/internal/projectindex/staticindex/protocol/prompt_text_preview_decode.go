package protocol

import "fmt"

// UnmarshalJSON keeps the flattened Go representation closed like the tagged
// Rust enum: fields from another provenance variant are rejected.
func (s *PromptTextPreviewSegment) UnmarshalJSON(data []byte) error {
	kind, err := promptTextVariantKind(data)
	if err != nil {
		return err
	}
	var decoded PromptTextPreviewSegment
	switch PromptTextPreviewSegmentKind(kind) {
	case PromptTextPreviewAuthoredLiteral:
		var value struct {
			Kind  PromptTextPreviewSegmentKind `json:"kind"`
			Text  *string                      `json:"text"`
			Range *PromptTextRange             `json:"range"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded.Kind = value.Kind
			decoded.Text, err = requiredPromptTextField(value.Text, "text")
		}
		if err == nil {
			decoded.Range, err = requiredPromptTextFieldPointer(value.Range, "range")
		}
	case PromptTextPreviewKnownValue, PromptTextPreviewPlaceholder:
		var value struct {
			Kind              PromptTextPreviewSegmentKind `json:"kind"`
			Text              *string                      `json:"text"`
			Interpolation     *uint32                      `json:"interpolation"`
			InterpolationPath []uint32                     `json:"interpolationPath"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded.Kind = value.Kind
			decoded.Text, err = requiredPromptTextField(value.Text, "text")
		}
		if err == nil {
			decoded.Interpolation, err = requiredPromptTextField(
				value.Interpolation, "interpolation",
			)
		}
		if err == nil && value.InterpolationPath == nil {
			err = fmt.Errorf("missing required PromptText field %q", "interpolationPath")
		}
		decoded.InterpolationPath = value.InterpolationPath
	case PromptTextPreviewFragment:
		var value struct {
			Kind       PromptTextPreviewSegmentKind `json:"kind"`
			Text       *string                      `json:"text"`
			FragmentID *string                      `json:"fragmentId"`
			SourceHash *string                      `json:"sourceHash"`
		}
		if err = decodeClosedPromptTextVariant(data, &value); err == nil {
			decoded.Kind = value.Kind
			decoded.Text, err = requiredPromptTextField(value.Text, "text")
		}
		if err == nil {
			decoded.FragmentID, err = requiredPromptTextField(value.FragmentID, "fragmentId")
		}
		if err == nil {
			decoded.SourceHash, err = requiredPromptTextField(value.SourceHash, "sourceHash")
		}
	default:
		return fmt.Errorf("unknown PromptText preview segment kind %q", kind)
	}
	if err != nil {
		return err
	}
	*s = decoded
	return nil
}
