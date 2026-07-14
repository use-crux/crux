package model

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// FindConflict checks proposed tool IDs against every other owner and the
// authored base without modifying either source of truth.
func (s *RuntimeOverlayState) FindConflict(
	base store.IndexData,
	update ProjectIndexRuntimeUpdate,
) *RuntimeUpdateConflictError {
	for _, proposed := range update.Definitions {
		for ownerID, overlay := range s.byOwner {
			if ownerID == update.Owner.DefinitionID {
				continue
			}
			if overlayHasDefinition(overlay, proposed.ID) {
				return runtimeUpdateConflict(update.Owner.DefinitionID, ownerID, proposed.ID)
			}
		}
		if ownerID, found := authoredDefinitionOwner(base, proposed.ID); found && ownerID != update.Owner.DefinitionID {
			return runtimeUpdateConflict(update.Owner.DefinitionID, ownerID, proposed.ID)
		}
	}
	return nil
}

// ApplyConflict preserves the rejected owner's last-known facts, marks current
// children stale, and records one safe diagnostic for the rejected update.
func (s *RuntimeOverlayState) ApplyConflict(
	update ProjectIndexRuntimeUpdate,
	conflict *RuntimeUpdateConflictError,
) {
	previous := s.byOwner[update.Owner.DefinitionID]
	next := RuntimeOverlay{
		Owner:       update.Owner,
		ObservedAt:  update.ObservedAt,
		Revision:    previous.Revision,
		Error:       &RuntimeUpdateError{Phase: "discover", Category: "tool-name-collision"},
		Definitions: append([]store.ProjectDefinition(nil), previous.Definitions...),
		Relations:   append([]store.ProjectRelation(nil), previous.Relations...),
	}
	for index, definition := range next.Definitions {
		if definition.Status == "active" {
			next.Definitions[index].Status = "stale"
		}
	}
	next.Diagnostics = []store.IndexDiagnostic{{
		ID:       fmt.Sprintf("diagnostic:mcp-tool-name-collision:%s:%s", update.Owner.DefinitionID, conflict.ToolID),
		Severity: "error",
		Code:     "mcp.tool_name_collision",
		Message:  "An MCP tool name conflicts with another Project Index owner.",
		RelatedDefinitionIDs: []string{
			update.Owner.DefinitionID,
			conflict.ConflictingOwnerID,
			conflict.ToolID,
		},
		SuggestedFix: "Configure an MCP tool prefix so every exposed tool name is unique.",
	}}
	s.byOwner[update.Owner.DefinitionID] = next
}

func runtimeUpdateConflict(ownerID, conflictingOwnerID, toolID string) *RuntimeUpdateConflictError {
	return &RuntimeUpdateConflictError{
		OwnerID: ownerID, ConflictingOwnerID: conflictingOwnerID, ToolID: toolID,
	}
}

func overlayHasDefinition(overlay RuntimeOverlay, definitionID string) bool {
	for _, definition := range overlay.Definitions {
		if definition.ID == definitionID {
			return true
		}
	}
	return false
}

func authoredDefinitionOwner(base store.IndexData, definitionID string) (string, bool) {
	for _, definition := range base.Definitions {
		if definition.ID != definitionID || definition.Kind != "tool" {
			continue
		}
		for _, relation := range base.Relations {
			if relation.Type == "mcp.server.provides_tool" && relation.To == definitionID {
				return relation.From, true
			}
		}
		return definition.ID, true
	}
	return "", false
}
