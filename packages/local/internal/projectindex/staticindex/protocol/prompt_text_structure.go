package protocol

// PromptTextLiteralIsland is one authored region between interpolation
// barriers.
type PromptTextLiteralIsland struct {
	Index            uint32          `json:"index"`
	Range            PromptTextRange `json:"range"`
	ProjectionLength uint32          `json:"projectionLength"`
}

// PromptTextLineIsolationEdit is an exact source replacement whose
// applicability was proven counterfactually by Rust. Go validates and copies
// these bytes but never derives layout, indentation, or line endings.
type PromptTextLineIsolationEdit struct {
	Range        PromptTextRange `json:"range"`
	ExpectedText string          `json:"expectedText"`
	NewText      string          `json:"newText"`
}

// PromptTextInterpolationBarrier is one opaque `${ expression }` region.
type PromptTextInterpolationBarrier struct {
	Index             uint32                       `json:"index"`
	Range             PromptTextRange              `json:"range"`
	ExpressionRange   PromptTextRange              `json:"expressionRange"`
	LineIsolationEdit *PromptTextLineIsolationEdit `json:"lineIsolationEdit,omitempty"`
}

// PromptTextSourceMapping maps UTF-16 projection offsets back to authored
// source positions.
type PromptTextSourceMapping struct {
	Island          uint32                `json:"island"`
	ProjectionRange PromptTextOffsetRange `json:"projectionRange"`
	SourceRange     PromptTextRange       `json:"sourceRange"`
}

// PromptTextBlockKind identifies one normalized CommonMark block.
type PromptTextBlockKind string

const (
	PromptTextBlockHeading       PromptTextBlockKind = "heading"
	PromptTextBlockParagraph     PromptTextBlockKind = "paragraph"
	PromptTextBlockBlockquote    PromptTextBlockKind = "blockquote"
	PromptTextBlockList          PromptTextBlockKind = "list"
	PromptTextBlockListItem      PromptTextBlockKind = "list-item"
	PromptTextBlockCode          PromptTextBlockKind = "code-block"
	PromptTextBlockThematicBreak PromptTextBlockKind = "thematic-break"
	PromptTextBlockHTML          PromptTextBlockKind = "html"
)

// PromptTextBlock decodes the closed Rust block union.
//
// Variant-specific fields remain at their zero value for other kinds.
type PromptTextBlock struct {
	Kind         PromptTextBlockKind `json:"kind"`
	Index        uint32              `json:"index"`
	Island       uint32              `json:"island"`
	Level        uint8               `json:"level,omitempty"`
	Label        *string             `json:"label,omitempty"`
	Range        PromptTextRange     `json:"range"`
	TextRange    *PromptTextRange    `json:"textRange,omitempty"`
	MarkerRanges []PromptTextRange   `json:"markerRanges,omitempty"`
	MarkerRange  *PromptTextRange    `json:"markerRange,omitempty"`
	Ordered      bool                `json:"ordered,omitempty"`
	Start        *uint64             `json:"start,omitempty"`
	ContentRange *PromptTextRange    `json:"contentRange,omitempty"`
	Fenced       bool                `json:"fenced,omitempty"`
	Info         *string             `json:"info,omitempty"`
}

// PromptTextHeading exposes the fields guaranteed by the heading variant.
type PromptTextHeading struct {
	Index     uint32
	Island    uint32
	Level     uint8
	Label     string
	Range     PromptTextRange
	TextRange PromptTextRange
}

// Heading returns the typed heading payload when the block discriminant
// matches.
func (b PromptTextBlock) Heading() (PromptTextHeading, bool) {
	if b.Kind != PromptTextBlockHeading || b.TextRange == nil || b.Label == nil ||
		*b.Label == "" || b.Level < 1 || b.Level > 6 {
		return PromptTextHeading{}, false
	}
	return PromptTextHeading{
		Index: b.Index, Island: b.Island, Level: b.Level,
		Label: *b.Label, Range: b.Range, TextRange: *b.TextRange,
	}, true
}

// PromptTextSpanKind identifies one normalized inline span.
type PromptTextSpanKind string

const (
	PromptTextSpanEmphasis   PromptTextSpanKind = "emphasis"
	PromptTextSpanStrong     PromptTextSpanKind = "strong"
	PromptTextSpanInlineCode PromptTextSpanKind = "inline-code"
	PromptTextSpanHTML       PromptTextSpanKind = "html"
	PromptTextSpanSoftBreak  PromptTextSpanKind = "soft-break"
	PromptTextSpanHardBreak  PromptTextSpanKind = "hard-break"
)

// PromptTextSpan decodes the closed Rust inline-span union.
type PromptTextSpan struct {
	Kind      PromptTextSpanKind `json:"kind"`
	Index     uint32             `json:"index"`
	Island    uint32             `json:"island"`
	Range     PromptTextRange    `json:"range"`
	TextRange *PromptTextRange   `json:"textRange,omitempty"`
}

// PromptTextLinkKind identifies one parser-confirmed literal link shape.
type PromptTextLinkKind string

const (
	PromptTextLinkInline   PromptTextLinkKind = "inline"
	PromptTextLinkAutolink PromptTextLinkKind = "autolink"
)

// PromptTextLink decodes the closed Rust literal-link union.
type PromptTextLink struct {
	Kind             PromptTextLinkKind `json:"kind"`
	Index            uint32             `json:"index"`
	Island           uint32             `json:"island"`
	Range            PromptTextRange    `json:"range"`
	TextRange        PromptTextRange    `json:"textRange"`
	DestinationRange *PromptTextRange   `json:"destinationRange,omitempty"`
	Destination      string             `json:"destination"`
	Title            *string            `json:"title,omitempty"`
}

// PromptTextNodeKind identifies a normalized nesting endpoint.
type PromptTextNodeKind string

const (
	PromptTextNodeBlock PromptTextNodeKind = "block"
	PromptTextNodeSpan  PromptTextNodeKind = "span"
	PromptTextNodeLink  PromptTextNodeKind = "link"
)

// PromptTextNodeRef points to one block, span, or link by local index.
type PromptTextNodeRef struct {
	Kind  PromptTextNodeKind `json:"kind"`
	Index uint32             `json:"index"`
}

// PromptTextNesting preserves parser-proven parent/child order.
type PromptTextNesting struct {
	Parent  PromptTextNodeRef `json:"parent"`
	Child   PromptTextNodeRef `json:"child"`
	Ordinal uint32            `json:"ordinal"`
}

// PromptTextTemplate is one tag-neutral candidate and its normalized payload.
type PromptTextTemplate struct {
	CandidateID           uint32                           `json:"candidateId"`
	Range                 PromptTextRange                  `json:"range"`
	TagRange              PromptTextRange                  `json:"tagRange"`
	TemplateRange         PromptTextRange                  `json:"templateRange"`
	BacktickRanges        [2]PromptTextRange               `json:"backtickRanges"`
	Status                PromptTextAnalysisStatus         `json:"status"`
	LiteralIslands        []PromptTextLiteralIsland        `json:"literalIslands"`
	InterpolationBarriers []PromptTextInterpolationBarrier `json:"interpolationBarriers"`
	Mappings              []PromptTextSourceMapping        `json:"mappings"`
	Blocks                []PromptTextBlock                `json:"blocks"`
	Spans                 []PromptTextSpan                 `json:"spans"`
	Links                 []PromptTextLink                 `json:"links"`
	Nesting               []PromptTextNesting              `json:"nesting"`
	Preview               PromptTextPreview                `json:"preview"`
}
