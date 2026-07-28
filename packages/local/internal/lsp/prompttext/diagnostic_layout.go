package prompttext

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// validatedLineIsolationEdit verifies that Rust's counterfactual proof still
// addresses the exact current source. It deliberately does not derive layout,
// indentation, or line endings.
func validatedLineIsolationEdit(
	text string,
	template staticprotocol.PromptTextTemplate,
	target staticprotocol.PromptTextInterpolationBarrier,
) *protocol.TextEdit {
	proof := target.LineIsolationEdit
	if proof == nil ||
		proof.ExpectedText == "" ||
		proof.NewText == "" ||
		proof.ExpectedText == proof.NewText ||
		!promptRangeStrictlyInside(proof.Range, template.TemplateRange) ||
		!promptRangeInside(target.Range, proof.Range) ||
		!promptRangeStrictlyInside(target.ExpressionRange, target.Range) ||
		!proofContainsOnlyTargetBarrier(template.InterpolationBarriers, target, proof.Range) {
		return nil
	}

	expectedText, expectedOK := textForPromptRange(text, proof.Range)
	barrierText, barrierOK := textForPromptRange(text, target.Range)
	expressionText, expressionOK := textForPromptRange(text, target.ExpressionRange)
	if !expectedOK || !barrierOK || !expressionOK ||
		expectedText != proof.ExpectedText ||
		barrierText == "" ||
		expressionText == "" ||
		!containsExactBarrierOnce(proof.ExpectedText, barrierText) ||
		!containsExactBarrierOnce(proof.NewText, barrierText) ||
		!validAuthoredLineIsolationScaffolding(proof.ExpectedText, barrierText) ||
		!validReplacementLineIsolationScaffolding(proof.NewText, barrierText) {
		return nil
	}

	return &protocol.TextEdit{
		Range:   editorRange(proof.Range),
		NewText: proof.NewText,
	}
}

func promptRangeInside(
	inner, outer staticprotocol.PromptTextRange,
) bool {
	return comparePromptPosition(inner.Start, inner.End) < 0 &&
		comparePromptPosition(outer.Start, inner.Start) <= 0 &&
		comparePromptPosition(inner.End, outer.End) <= 0
}

func promptRangeStrictlyInside(
	inner, outer staticprotocol.PromptTextRange,
) bool {
	return comparePromptPosition(inner.Start, inner.End) < 0 &&
		comparePromptPosition(outer.Start, inner.Start) < 0 &&
		comparePromptPosition(inner.End, outer.End) < 0
}

func proofContainsOnlyTargetBarrier(
	barriers []staticprotocol.PromptTextInterpolationBarrier,
	target staticprotocol.PromptTextInterpolationBarrier,
	proofRange staticprotocol.PromptTextRange,
) bool {
	targetCount := 0
	for _, barrier := range barriers {
		if barrier == target {
			targetCount++
			continue
		}
		if promptRangesOverlap(barrier.Range, proofRange) {
			return false
		}
	}
	return targetCount == 1
}

func uniqueBarrierExpressionRange(
	barriers []staticprotocol.PromptTextInterpolationBarrier,
	target staticprotocol.PromptTextInterpolationBarrier,
) bool {
	count := 0
	for _, barrier := range barriers {
		if barrier.ExpressionRange == target.ExpressionRange {
			count++
		}
	}
	return count == 1
}

func promptRangesOverlap(
	left, right staticprotocol.PromptTextRange,
) bool {
	return comparePromptPosition(left.Start, right.End) < 0 &&
		comparePromptPosition(right.Start, left.End) < 0
}

func containsExactBarrierOnce(text, barrier string) bool {
	return strings.Count(text, barrier) == 1
}

func validAuthoredLineIsolationScaffolding(text, barrier string) bool {
	before, after, found := strings.Cut(text, barrier)
	return found &&
		onlyASCIIHorizontalWhitespace(before) &&
		onlyASCIIHorizontalWhitespace(after)
}

func validReplacementLineIsolationScaffolding(text, barrier string) bool {
	before, after, found := strings.Cut(text, barrier)
	return found &&
		(before != "" || after != "") &&
		validLineIsolationSide(before) &&
		validLineIsolationSide(after)
}

func onlyASCIIHorizontalWhitespace(value string) bool {
	for index := 0; index < len(value); index++ {
		if value[index] != ' ' && value[index] != '\t' {
			return false
		}
	}
	return true
}

func validLineIsolationSide(value string) bool {
	switch {
	case value == "":
		return true
	case strings.HasPrefix(value, "\r\n"):
		value = value[2:]
	case strings.HasPrefix(value, "\n"):
		value = value[1:]
	default:
		return false
	}
	return onlyASCIIHorizontalWhitespace(value)
}
