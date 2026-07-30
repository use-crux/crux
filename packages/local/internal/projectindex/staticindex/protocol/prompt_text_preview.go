package protocol

// PromptTextPreviewSegmentKind identifies one static-preview provenance shape.
type PromptTextPreviewSegmentKind string

const (
	PromptTextPreviewAuthoredLiteral PromptTextPreviewSegmentKind = "authored-literal"
	PromptTextPreviewKnownValue      PromptTextPreviewSegmentKind = "known-value"
	PromptTextPreviewFragment        PromptTextPreviewSegmentKind = "fragment"
	PromptTextPreviewPlaceholder     PromptTextPreviewSegmentKind = "placeholder"
)

// PromptTextPreviewSegment is one ordered provenance segment.
//
// Fields not owned by Kind remain at their zero value after JSON decoding.
type PromptTextPreviewSegment struct {
	Kind              PromptTextPreviewSegmentKind `json:"kind"`
	Text              string                       `json:"text"`
	Range             *PromptTextRange             `json:"range,omitempty"`
	Interpolation     uint32                       `json:"interpolation,omitempty"`
	InterpolationPath []uint32                     `json:"interpolationPath,omitempty"`
	FragmentID        string                       `json:"fragmentId,omitempty"`
	SourceHash        string                       `json:"sourceHash,omitempty"`
}

// PromptTextPreviewEvidence is the strongest proof that contributed bytes.
type PromptTextPreviewEvidence string

const (
	PromptTextPreviewSyntaxExact   PromptTextPreviewEvidence = "syntax-exact"
	PromptTextPreviewSemanticExact PromptTextPreviewEvidence = "semantic-exact"
)

// PromptTextPreviewStatusKind reports preview completeness independently from
// the containing template's structural status.
type PromptTextPreviewStatusKind string

const (
	PromptTextPreviewComplete    PromptTextPreviewStatusKind = "complete"
	PromptTextPreviewTruncated   PromptTextPreviewStatusKind = "truncated"
	PromptTextPreviewUnavailable PromptTextPreviewStatusKind = "unavailable"
)

// PromptTextPreviewStatus is the closed preview status union.
type PromptTextPreviewStatus struct {
	Kind PromptTextPreviewStatusKind `json:"kind"`
}

// PromptTextPreviewTruncationReason identifies the first preview-only limit.
type PromptTextPreviewTruncationReason string

const (
	PromptTextTruncatedByPreviewBytes  PromptTextPreviewTruncationReason = "max-preview-bytes"
	PromptTextTruncatedByFragmentDepth PromptTextPreviewTruncationReason = "max-fragment-depth"
)

// PromptTextPreviewTruncation describes metadata-only preview truncation.
type PromptTextPreviewTruncation struct {
	Reason       PromptTextPreviewTruncationReason `json:"reason"`
	Limit        uint32                            `json:"limit"`
	EmittedBytes uint32                            `json:"emittedBytes"`
}

// PromptTextPreview contains content bytes and their exact reconstruction
// segments. Concatenating segment text must equal Text.
type PromptTextPreview struct {
	Status     PromptTextPreviewStatus      `json:"status"`
	Evidence   *PromptTextPreviewEvidence   `json:"evidence"`
	Text       string                       `json:"text"`
	Segments   []PromptTextPreviewSegment   `json:"segments"`
	Truncation *PromptTextPreviewTruncation `json:"truncation"`
}
