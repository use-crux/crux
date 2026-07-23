package mapping

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const relatedInformationLimit = 20

func (m *Mapper) relatedInformation(
	finding api.IndexLintFinding,
	findingURI protocol.DocumentURI,
	findingRange protocol.Range,
) []protocol.DiagnosticRelatedInformation {
	var entries []protocol.DiagnosticRelatedInformation
	for _, evidence := range finding.Evidence {
		if evidence.Source == nil {
			continue
		}
		message := evidence.Label
		if evidence.Description != "" {
			message += ": " + evidence.Description
		}
		entries = append(entries, protocol.DiagnosticRelatedInformation{
			Location: protocol.Location{
				URI:   protocol.DocumentURI(FileURI(m.options.Root, evidence.Source.File)),
				Range: m.sourceLocRange(*evidence.Source),
			},
			Message: message,
		})
	}
	for _, path := range finding.PropagationPaths {
		entries = append(entries, protocol.DiagnosticRelatedInformation{
			Location: protocol.Location{URI: findingURI, Range: findingRange},
			Message:  fmt.Sprintf("propagates to %s via %s", path.ToDefinitionID, strings.Join(path.RelationTypes, ", ")),
		})
	}
	if len(entries) <= relatedInformationLimit {
		return entries
	}
	omitted := len(entries) - relatedInformationLimit
	entries = entries[:relatedInformationLimit]
	return append(entries, protocol.DiagnosticRelatedInformation{
		Location: protocol.Location{URI: findingURI, Range: findingRange},
		Message:  fmt.Sprintf("…and %d more evidence entries (see crux devtools)", omitted),
	})
}
