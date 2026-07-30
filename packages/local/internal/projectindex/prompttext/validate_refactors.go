package prompttext

import (
	"fmt"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func validateRefactors(
	analysis staticprotocol.PromptTextRefactorAnalysis,
	requestStatus staticprotocol.PromptTextStatusKind,
) error {
	if !validAnalysisStatus(analysis.Status.Kind) {
		return fmt.Errorf("PromptText compiler returned unknown refactor status %q", analysis.Status.Kind)
	}
	if analysis.Proofs == nil {
		return fmt.Errorf("PromptText compiler returned null refactor proof list")
	}
	if (analysis.Status.Kind == staticprotocol.PromptTextStatusUnsupported ||
		requestStatus == staticprotocol.PromptTextStatusUnsupported) &&
		len(analysis.Proofs) != 0 {
		return fmt.Errorf("unsupported PromptText analysis contains refactor proofs")
	}
	for index, proof := range analysis.Proofs {
		if proof.Kind != "ordinary-string-to-md" ||
			proof.Proof != staticprotocol.PromptTextRefactorProofSyntaxExact ||
			proof.TemplateText == "" ||
			proof.TemplateText[0] != '`' ||
			proof.TemplateText[len(proof.TemplateText)-1] != '`' ||
			proof.ExpectedText == "" ||
			comparePromptTextPosition(proof.Range.Start, proof.Range.End) >= 0 {
			return fmt.Errorf("PromptText refactor proof %d is invalid", index)
		}
	}
	return nil
}
