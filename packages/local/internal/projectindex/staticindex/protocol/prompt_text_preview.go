package protocol

// PromptTextPreviewSegmentKind identifies one static-preview provenance shape.
type PromptTextPreviewSegmentKind string

const (
	PromptTextPreviewAuthoredLiteral PromptTextPreviewSegmentKind = "authored-literal"
	PromptTextPreviewKnownValue      PromptTextPreviewSegmentKind = "known-value"
	PromptTextPreviewFragment        PromptTextPreviewSegmentKind = "fragment"
	PromptTextPreviewPlaceholder     PromptTextPreviewSegmentKind = "placeholder"
	PromptTextPreviewTruncation      PromptTextPreviewSegmentKind = "truncation"
)

// PromptTextPreviewSegment is one ordered provenance segment.
//
// Fields not owned by Kind remain at their zero value after JSON decoding.
type PromptTextPreviewSegment struct {
	Kind          PromptTextPreviewSegmentKind `json:"kind"`
	Text          string                       `json:"text"`
	Range         *PromptTextRange             `json:"range,omitempty"`
	Interpolation uint32                       `json:"interpolation,omitempty"`
	FragmentID    string                       `json:"fragmentId,omitempty"`
	SourceHash    string                       `json:"sourceHash,omitempty"`
}

// PromptTextPreview contains content bytes and their exact reconstruction
// segments. Concatenating segment text must equal Text.
type PromptTextPreview struct {
	Text     string                     `json:"text"`
	Segments []PromptTextPreviewSegment `json:"segments"`
}
