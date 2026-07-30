package server

import (
	"github.com/use-crux/crux/packages/local/internal/api"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
)

func promptTextDefinitionSummary(
	hover lsprompttext.PromptTextHover,
) *definitionSummary {
	if len(hover.Owners) != 1 {
		return nil
	}
	owner := hover.Owners[0]
	return &definitionSummary{
		Definition: documentDefinition{
			Definition: api.ProjectDefinition{
				ID: owner.ID, Kind: owner.Kind, Name: owner.Name,
				Description: owner.Description,
			},
			Range: owner.Location.Range,
		},
		IncomingRelations: owner.IncomingRelations,
		OutgoingRelations: owner.OutgoingRelations,
	}
}
