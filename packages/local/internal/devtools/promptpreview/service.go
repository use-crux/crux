package promptpreview

import (
	"context"
	"encoding/json"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type indexReader interface {
	ProjectIndexSnapshot() store.IndexData
}

type bridgePort interface {
	PromptPreviewProjection(string) runtimebridge.PromptPreviewProjection
	Dispatch(context.Context, runtimebridge.DispatchRequest) (runtimebridge.DispatchResponse, error)
}

// Service composes current Project Index ownership with a narrow Runtime
// Bridge projection. It never exposes the bridge's private peer records.
type Service struct {
	index  indexReader
	bridge bridgePort
}

func New(index indexReader, bridge bridgePort) *Service {
	return &Service{index: index, bridge: bridge}
}

func (s *Service) Discover(definitionID string) Discovery {
	projection := s.bridge.PromptPreviewProjection(definitionID)
	owner, reason := currentPromptOwner(s.index.ProjectIndexSnapshot(), definitionID)
	if reason != "" {
		return unavailable(projection.Revision, reason)
	}
	switch {
	case projection.LivePeerCount == 0:
		return unavailable(projection.Revision, "no-peer")
	case projection.PreviewPeerCount == 0:
		return unavailable(projection.Revision, "capability-unavailable")
	case len(projection.Choices) == 0:
		return unavailable(projection.Revision, "target-unavailable")
	case len(projection.Choices) > maxDiscoveryChoices:
		return unavailable(projection.Revision, "projection-limit-exceeded")
	}
	choices := make([]RuntimeChoice, 0, len(projection.Choices))
	for _, choice := range projection.Choices {
		if !validProjectedChoice(choice) {
			return unavailable(projection.Revision, "projection-limit-exceeded")
		}
		choices = append(choices, RuntimeChoice{
			PeerID: choice.PeerID, RuntimeName: choice.RuntimeName,
			Environment: choice.Environment, CatalogueRevision: choice.CatalogueRevision,
			Target: ChoiceTarget{
				Name: choice.Target.Name, Description: choice.Target.Description,
				Input: choice.Target.Input,
			},
		})
	}
	result := Discovery{
		Status: "ready", ProjectionRevision: projection.Revision,
		Owner: owner, Choices: choices,
	}
	encoded, err := json.Marshal(result)
	if err != nil || len(encoded) > maxDiscoveryBytes {
		return unavailable(projection.Revision, "projection-limit-exceeded")
	}
	return result
}

func currentPromptOwner(index store.IndexData, definitionID string) (*Owner, string) {
	var match *store.ProjectDefinition
	for i := range index.Definitions {
		if index.Definitions[i].ID != definitionID {
			continue
		}
		if match != nil {
			return nil, "owner-not-found"
		}
		match = &index.Definitions[i]
	}
	if match == nil {
		return nil, "owner-not-found"
	}
	if match.Kind != "prompt" {
		return nil, "owner-not-prompt"
	}
	if !validScalarString(match.ID, 1, 512) ||
		!validScalarString(match.Name, 1, 512) ||
		!validOptionalScalarString(match.Description, 4096) {
		return nil, "owner-not-found"
	}
	return &Owner{
		DefinitionID: match.ID, Kind: "prompt", Name: match.Name,
		Description: match.Description,
	}, ""
}

func validProjectedChoice(choice runtimebridge.PromptPreviewChoice) bool {
	return validScalarString(choice.PeerID, 1, 128) &&
		validScalarString(choice.RuntimeName, 1, 256) &&
		validEnvironment(choice.Environment) &&
		choice.CatalogueRevision > 0 &&
		choice.CatalogueRevision <= 9_007_199_254_740_991 &&
		validScalarString(choice.Target.Name, 1, 512) &&
		validOptionalScalarString(choice.Target.Description, 4096)
}

func validEnvironment(value string) bool {
	switch value {
	case "node", "convex", "serverless", "browser", "unknown":
		return true
	default:
		return false
	}
}

func validScalarString(value string, minimum, maximum int) bool {
	if !utf8.ValidString(value) {
		return false
	}
	length := len(utf16.Encode([]rune(value)))
	return length >= minimum && length <= maximum
}

func validOptionalScalarString(value string, maximum int) bool {
	return value == "" || validScalarString(value, 1, maximum)
}

func unavailable(revision uint64, reason string) Discovery {
	return Discovery{
		Status: "unavailable", ProjectionRevision: revision,
		Reason: reason, Message: unavailableMessages[reason],
	}
}
