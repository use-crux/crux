package prompttext

import (
	"fmt"
	"strings"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// ValidateResult verifies the closed PromptText response ABI after either an
// OWN worker call or an ATTACHED transport decode.
func ValidateResult(response Result) error {
	if !validAnalysisStatus(response.Status.Kind) {
		return fmt.Errorf("PromptText compiler returned unknown request status %q", response.Status.Kind)
	}
	if response.Templates == nil {
		return fmt.Errorf("PromptText compiler returned null template list")
	}
	if response.Status.Kind == staticprotocol.PromptTextStatusUnsupported &&
		len(response.Templates) != 0 {
		return fmt.Errorf("unsupported PromptText request contains templates")
	}
	if err := validateRefactors(response.Refactors, response.Status.Kind); err != nil {
		return err
	}
	for index, template := range response.Templates {
		if err := validateTemplate(template); err != nil {
			return fmt.Errorf("PromptText template %d: %w", index, err)
		}
	}
	return nil
}

func validateTemplate(template staticprotocol.PromptTextTemplate) error {
	if !validAnalysisStatus(template.Status.Kind) {
		return fmt.Errorf("unknown status %q", template.Status.Kind)
	}
	if template.LiteralIslands == nil ||
		template.InterpolationBarriers == nil ||
		template.Mappings == nil ||
		template.Blocks == nil ||
		template.Spans == nil ||
		template.Links == nil ||
		template.Nesting == nil {
		return fmt.Errorf("template contains a null payload collection")
	}
	if !validBackticks(template) {
		return fmt.Errorf("template contains invalid backtick ranges")
	}
	for _, block := range template.Blocks {
		if !validBlock(block) {
			return fmt.Errorf("invalid block kind or payload %q", block.Kind)
		}
	}
	for _, span := range template.Spans {
		if !validSpan(span) {
			return fmt.Errorf("invalid span kind or payload %q", span.Kind)
		}
	}
	for _, link := range template.Links {
		if !validLink(link) {
			return fmt.Errorf("invalid link kind or payload %q", link.Kind)
		}
	}
	for _, nesting := range template.Nesting {
		if !validNodeKind(nesting.Parent.Kind) || !validNodeKind(nesting.Child.Kind) {
			return fmt.Errorf("unknown nesting node kind")
		}
	}
	if err := validatePreview(template.Preview); err != nil {
		return err
	}
	if template.Status.Kind == staticprotocol.PromptTextStatusUnsupported &&
		!unsupportedTemplateIsEmpty(template) {
		return fmt.Errorf("unsupported template contains payload")
	}
	return nil
}

func validBackticks(template staticprotocol.PromptTextTemplate) bool {
	open, close := template.BacktickRanges[0], template.BacktickRanges[1]
	return rangeWithin(template.TemplateRange, open) &&
		rangeWithin(template.TemplateRange, close) &&
		comparePromptTextPosition(open.Start, open.End) < 0 &&
		comparePromptTextPosition(close.Start, close.End) < 0 &&
		open.Start.Line == open.End.Line &&
		close.Start.Line == close.End.Line &&
		open.End.Character == open.Start.Character+1 &&
		close.End.Character == close.Start.Character+1 &&
		comparePromptTextPosition(open.End, close.Start) <= 0
}

func rangeWithin(outer, inner staticprotocol.PromptTextRange) bool {
	return comparePromptTextPosition(outer.Start, inner.Start) <= 0 &&
		comparePromptTextPosition(inner.End, outer.End) <= 0
}

func comparePromptTextPosition(
	left, right staticprotocol.PromptTextPosition,
) int {
	if left.Line < right.Line ||
		left.Line == right.Line && left.Character < right.Character {
		return -1
	}
	if left == right {
		return 0
	}
	return 1
}

func validAnalysisStatus(kind staticprotocol.PromptTextStatusKind) bool {
	switch kind {
	case staticprotocol.PromptTextStatusComplete,
		staticprotocol.PromptTextStatusTruncated,
		staticprotocol.PromptTextStatusUnsupported:
		return true
	default:
		return false
	}
}

func validBlock(block staticprotocol.PromptTextBlock) bool {
	switch block.Kind {
	case staticprotocol.PromptTextBlockHeading:
		_, ok := block.Heading()
		return ok && block.MarkerRanges == nil && block.MarkerRange == nil &&
			!block.Ordered && block.Start == nil && block.ContentRange == nil &&
			!block.Fenced && block.Info == nil
	case staticprotocol.PromptTextBlockParagraph,
		staticprotocol.PromptTextBlockThematicBreak,
		staticprotocol.PromptTextBlockHTML:
		return blockPayloadIsEmpty(block)
	case staticprotocol.PromptTextBlockBlockquote:
		return block.MarkerRanges != nil && block.Level == 0 && block.Label == nil &&
			block.TextRange == nil && block.MarkerRange == nil && !block.Ordered &&
			block.Start == nil && block.ContentRange == nil && !block.Fenced &&
			block.Info == nil
	case staticprotocol.PromptTextBlockList:
		return block.Level == 0 && block.Label == nil && block.TextRange == nil &&
			block.MarkerRanges == nil && block.MarkerRange == nil &&
			block.ContentRange == nil && !block.Fenced && block.Info == nil
	case staticprotocol.PromptTextBlockListItem:
		return block.MarkerRange != nil && block.Level == 0 && block.Label == nil &&
			block.TextRange == nil && block.MarkerRanges == nil && !block.Ordered &&
			block.Start == nil && block.ContentRange == nil && !block.Fenced &&
			block.Info == nil
	case staticprotocol.PromptTextBlockCode:
		return block.ContentRange != nil && block.Level == 0 && block.Label == nil &&
			block.TextRange == nil && block.MarkerRanges == nil &&
			block.MarkerRange == nil && !block.Ordered && block.Start == nil
	default:
		return false
	}
}

func blockPayloadIsEmpty(block staticprotocol.PromptTextBlock) bool {
	return block.Level == 0 && block.Label == nil && block.TextRange == nil &&
		block.MarkerRanges == nil && block.MarkerRange == nil && !block.Ordered &&
		block.Start == nil && block.ContentRange == nil && !block.Fenced &&
		block.Info == nil
}

func validSpan(span staticprotocol.PromptTextSpan) bool {
	switch span.Kind {
	case staticprotocol.PromptTextSpanEmphasis,
		staticprotocol.PromptTextSpanStrong,
		staticprotocol.PromptTextSpanInlineCode:
		return span.TextRange != nil
	case
		staticprotocol.PromptTextSpanHTML,
		staticprotocol.PromptTextSpanSoftBreak,
		staticprotocol.PromptTextSpanHardBreak:
		return span.TextRange == nil
	default:
		return false
	}
}

func validLink(link staticprotocol.PromptTextLink) bool {
	switch link.Kind {
	case staticprotocol.PromptTextLinkInline:
		return link.DestinationRange != nil
	case staticprotocol.PromptTextLinkAutolink:
		return link.DestinationRange == nil && link.Title == nil
	default:
		return false
	}
}

func validNodeKind(kind staticprotocol.PromptTextNodeKind) bool {
	switch kind {
	case staticprotocol.PromptTextNodeBlock,
		staticprotocol.PromptTextNodeSpan,
		staticprotocol.PromptTextNodeLink:
		return true
	default:
		return false
	}
}

func validatePreview(preview staticprotocol.PromptTextPreview) error {
	if preview.Segments == nil {
		return fmt.Errorf("preview contains null segments")
	}
	switch preview.Status.Kind {
	case staticprotocol.PromptTextPreviewUnavailable:
		if preview.Evidence != nil || preview.Text != "" ||
			len(preview.Segments) != 0 || preview.Truncation != nil {
			return fmt.Errorf("unavailable preview contains payload")
		}
		return nil
	case staticprotocol.PromptTextPreviewComplete:
		if preview.Truncation != nil {
			return fmt.Errorf("complete preview contains truncation")
		}
	case staticprotocol.PromptTextPreviewTruncated:
		if !validPreviewTruncation(preview.Truncation) ||
			uint64(preview.Truncation.EmittedBytes) != uint64(len(preview.Text)) {
			return fmt.Errorf("invalid preview truncation")
		}
	default:
		return fmt.Errorf("unknown preview status %q", preview.Status.Kind)
	}
	if preview.Evidence == nil || !validPreviewEvidence(*preview.Evidence) {
		return fmt.Errorf("invalid preview evidence")
	}
	var reconstructed strings.Builder
	for _, segment := range preview.Segments {
		if !validPreviewSegment(segment) {
			return fmt.Errorf("invalid preview segment kind or payload %q", segment.Kind)
		}
		reconstructed.WriteString(segment.Text)
	}
	if reconstructed.String() != preview.Text {
		return fmt.Errorf("preview segments do not reconstruct text")
	}
	return nil
}

func validPreviewEvidence(evidence staticprotocol.PromptTextPreviewEvidence) bool {
	return evidence == staticprotocol.PromptTextPreviewSyntaxExact ||
		evidence == staticprotocol.PromptTextPreviewSemanticExact
}

func validPreviewTruncation(
	truncation *staticprotocol.PromptTextPreviewTruncation,
) bool {
	if truncation == nil {
		return false
	}
	switch truncation.Reason {
	case staticprotocol.PromptTextTruncatedByPreviewBytes,
		staticprotocol.PromptTextTruncatedByFragmentDepth:
		return true
	default:
		return false
	}
}

func validPreviewSegment(segment staticprotocol.PromptTextPreviewSegment) bool {
	if segment.Text == "" {
		return false
	}
	switch segment.Kind {
	case staticprotocol.PromptTextPreviewAuthoredLiteral:
		return segment.Range != nil && validNonemptyRange(*segment.Range) &&
			segment.Interpolation == 0 && segment.InterpolationPath == nil &&
			segment.FragmentID == "" && segment.SourceHash == ""
	case staticprotocol.PromptTextPreviewKnownValue:
		return segment.Range == nil && segment.InterpolationPath != nil &&
			segment.FragmentID == "" && segment.SourceHash == ""
	case staticprotocol.PromptTextPreviewPlaceholder:
		return segment.Range == nil && segment.InterpolationPath != nil &&
			segment.FragmentID == "" && segment.SourceHash == "" &&
			segment.Text == "⟪unknown⟫"
	case staticprotocol.PromptTextPreviewFragment:
		return segment.Range == nil && segment.Interpolation == 0 &&
			segment.InterpolationPath == nil && segment.FragmentID != "" &&
			canonicalSourceHash(segment.SourceHash)
	default:
		return false
	}
}

func unsupportedTemplateIsEmpty(template staticprotocol.PromptTextTemplate) bool {
	preview := template.Preview
	return len(template.LiteralIslands) == 0 &&
		len(template.InterpolationBarriers) == 0 &&
		len(template.Mappings) == 0 &&
		len(template.Blocks) == 0 &&
		len(template.Spans) == 0 &&
		len(template.Links) == 0 &&
		len(template.Nesting) == 0 &&
		preview.Status.Kind == staticprotocol.PromptTextPreviewUnavailable &&
		preview.Evidence == nil && preview.Text == "" &&
		len(preview.Segments) == 0 && preview.Truncation == nil
}
