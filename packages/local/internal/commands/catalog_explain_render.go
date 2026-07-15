package commands

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func printCatalogExplanation(io *output.IO, explanation api.CatalogExplanationV1) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "catalog explain"))
	fmt.Fprintf(io.Out, "  ID: %s\n", io.Sprint(output.BoldCyan, explanation.Definition.ID))
	fmt.Fprintf(io.Out, "  Kind: %s\n", valueOrUnknown(explanation.Definition.Kind))
	fmt.Fprintf(io.Out, "  Fidelity: %s\n", valueOrUnknown(explanation.Definition.Fidelity))
	fmt.Fprintf(io.Out, "  Status: %s\n", valueOrUnknown(explanation.Definition.Status))
	if len(explanation.Evidence) == 0 {
		fmt.Fprintln(io.Out, "\n  Evidence: unknown")
	} else {
		fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Evidence"))
		for _, evidence := range explanation.Evidence {
			fmt.Fprintf(io.Out, "    %s  %s  %s\n", evidence.Phase, evidence.Producer, evidence.Reason)
		}
	}
	if len(explanation.Relations.Incoming)+len(explanation.Relations.Outgoing) > 0 {
		printCatalogRelations(io, api.CatalogRelationsV1{
			Incoming: explanation.Relations.Incoming,
			Outgoing: explanation.Relations.Outgoing,
		})
	}
	if len(explanation.Relations.Unresolved) > 0 {
		fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Unresolved relations"))
		for _, relation := range explanation.Relations.Unresolved {
			fmt.Fprintf(io.Out, "    %s  %s\n", relation.ID, relation.Reason)
		}
	}
	printCatalogHealth(io, explanation.Diagnostics, explanation.Lints)
	fmt.Fprintf(io.Out, "\n  Cache: %s\n", valueOrUnknown(explanation.Indexing.Cache))
	if explanation.Indexing.Backend != "" {
		fmt.Fprintf(io.Out, "  Backend: %s\n", explanation.Indexing.Backend)
	}
	if explanation.Indexing.Fallback != "" {
		fmt.Fprintf(io.Out, "  Fallback: %s\n", explanation.Indexing.Fallback)
	}
	if explanation.Indexing.PartialReason != "" {
		fmt.Fprintf(io.Out, "  Partial: %s\n", explanation.Indexing.PartialReason)
	}
	if explanation.Manifest != nil {
		fmt.Fprintf(io.Out, "  Manifest: %s\n", explanation.Manifest.Resolution)
	}
}
