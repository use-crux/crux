package model

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func validateRuntimeFailure(update ProjectIndexRuntimeUpdate) error {
	if update.SchemaVersion != 1 {
		return fmt.Errorf("runtime update schemaVersion must be 1")
	}
	if update.UpdateID == "" || update.Owner.DefinitionID == "" || update.ObservedAt == "" {
		return fmt.Errorf("runtime failure identity is incomplete")
	}
	if update.Error == nil || update.Error.Phase == "" || update.Error.Category == "" {
		return fmt.Errorf("runtime failure classification is incomplete")
	}
	if update.Revision != "" || len(update.Definitions) != 0 || len(update.Relations) != 0 {
		return fmt.Errorf("runtime failure cannot carry replacement facts")
	}
	if update.Owner.Kind != "mcp.server" {
		return fmt.Errorf("runtime update owner kind %q is not supported", update.Owner.Kind)
	}
	return nil
}

func validateRuntimeReplace(update ProjectIndexRuntimeUpdate) error {
	if update.SchemaVersion != 1 {
		return fmt.Errorf("runtime update schemaVersion must be 1")
	}
	if update.Operation != RuntimeUpdateReplace {
		return fmt.Errorf("runtime update operation must be replace")
	}
	if update.UpdateID == "" || update.Owner.DefinitionID == "" || update.ObservedAt == "" || update.Revision == "" {
		return fmt.Errorf("runtime replacement identity is incomplete")
	}
	if update.Owner.Kind != "mcp.server" {
		return fmt.Errorf("runtime update owner kind %q is not supported", update.Owner.Kind)
	}
	return validateMCPRuntimeReplace(update, "")
}

// ValidateRuntimeUpdateAgainstBase binds an update to one authored owner.
func ValidateRuntimeUpdateAgainstBase(base store.IndexData, update ProjectIndexRuntimeUpdate) error {
	if err := ValidateRuntimeUpdate(update); err != nil {
		return err
	}
	for _, definition := range base.Definitions {
		if definition.ID != update.Owner.DefinitionID {
			continue
		}
		if definition.Kind != update.Owner.Kind {
			return fmt.Errorf("runtime update owner kind does not match its authored definition")
		}
		if update.Operation == RuntimeUpdateReplace {
			return validateMCPRuntimeReplace(update, definition.Name)
		}
		return nil
	}
	return fmt.Errorf("runtime update owner %q is not authored", update.Owner.DefinitionID)
}

func validateMCPRuntimeReplace(update ProjectIndexRuntimeUpdate, ownerServerID string) error {
	toolIDs := map[string]bool{}
	for _, definition := range update.Definitions {
		if definition.Kind != "tool" {
			return fmt.Errorf("MCP runtime child %q must be a tool", definition.ID)
		}
		if definition.ID == "" || definition.Name == "" || definition.ID != "tool:"+definition.Name {
			return fmt.Errorf("MCP runtime child has an invalid ordinary tool identity")
		}
		if toolIDs[definition.ID] {
			return fmt.Errorf("MCP runtime replacement repeats tool %q", definition.ID)
		}
		toolIDs[definition.ID] = true
		if definition.SourceSnippet != nil {
			return fmt.Errorf("MCP runtime child %q cannot contain a source snippet", definition.ID)
		}
		if definition.Fidelity != "resolved" || definition.Fingerprint == "" {
			return fmt.Errorf("MCP runtime child %q must be resolved and fingerprinted", definition.ID)
		}
		if len(definition.Tags) != 0 || len(definition.Path) != 0 || definition.Source != nil ||
			len(definition.SourceRefs) != 0 || definition.Quality != nil {
			return fmt.Errorf("MCP runtime child %q contains unsupported authored or derived fields", definition.ID)
		}
		if definition.Status != "" && definition.Status != "active" {
			return fmt.Errorf("MCP runtime child %q has an invalid availability status", definition.ID)
		}
		if err := validateMCPRuntimeMetadata(
			definition,
			ownerServerID,
			update.ObservedAt,
			update.Revision,
		); err != nil {
			return err
		}
	}
	relationTargets := map[string]bool{}
	for _, relation := range update.Relations {
		if relation.Type != "mcp.server.provides_tool" || relation.From != update.Owner.DefinitionID {
			return fmt.Errorf("MCP runtime relation %q does not belong to owner %q", relation.ID, update.Owner.DefinitionID)
		}
		if relation.ID == "" || relation.Fidelity != "resolved" || relation.Source != nil || len(relation.Metadata) != 0 {
			return fmt.Errorf("MCP runtime relation %q contains unsupported fields", relation.ID)
		}
		if !toolIDs[relation.To] {
			return fmt.Errorf("MCP runtime relation %q targets an unknown child", relation.ID)
		}
		if relationTargets[relation.To] {
			return fmt.Errorf("MCP runtime child %q has multiple owner relations", relation.To)
		}
		relationTargets[relation.To] = true
	}
	for toolID := range toolIDs {
		if !relationTargets[toolID] {
			return fmt.Errorf("MCP runtime child %q is missing its owner relation", toolID)
		}
	}
	return nil
}
