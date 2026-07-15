package model

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// RuntimeOverlayState owns runtime contributions independently from authored
// and compiler phase state so one owner can be replaced atomically.
type RuntimeOverlayState struct {
	byOwner map[string]RuntimeOverlay
}

func NewRuntimeOverlayState() *RuntimeOverlayState {
	return &RuntimeOverlayState{byOwner: map[string]RuntimeOverlay{}}
}

// Hydrate replaces in-memory overlays from persistence. Restart hydration may
// conservatively stale observations that were active in the prior process.
func (s *RuntimeOverlayState) Hydrate(overlays []RuntimeOverlay, staleActive bool) {
	s.byOwner = map[string]RuntimeOverlay{}
	for _, overlay := range overlays {
		if staleActive {
			staleActiveDefinitions(overlay.Definitions)
		}
		s.byOwner[overlay.Owner.DefinitionID] = overlay
	}
}

// Overlay returns a detached snapshot for persistence.
func (s *RuntimeOverlayState) Overlay(ownerDefinitionID string) (RuntimeOverlay, bool) {
	overlay, ok := s.byOwner[ownerDefinitionID]
	if !ok {
		return RuntimeOverlay{}, false
	}
	overlay.Definitions = append([]store.ProjectDefinition(nil), overlay.Definitions...)
	overlay.Relations = append([]store.ProjectRelation(nil), overlay.Relations...)
	overlay.Diagnostics = append([]store.IndexDiagnostic(nil), overlay.Diagnostics...)
	return overlay, true
}

// Restore replaces one owner with a previously detached snapshot, or removes
// it when the failed operation had no predecessor.
func (s *RuntimeOverlayState) Restore(ownerDefinitionID string, overlay RuntimeOverlay, existed bool) {
	if !existed {
		delete(s.byOwner, ownerDefinitionID)
		return
	}
	s.byOwner[ownerDefinitionID] = overlay
}

// SetOwnerFingerprint captures the authored identity observed with an update.
func (s *RuntimeOverlayState) SetOwnerFingerprint(ownerDefinitionID, fingerprint string) {
	overlay, ok := s.byOwner[ownerDefinitionID]
	if !ok {
		return
	}
	overlay.OwnerFingerprint = fingerprint
	s.byOwner[ownerDefinitionID] = overlay
}

// ReconcileAuthoritativeBase removes absent owners and stales active children
// when an authoritative authored server fingerprint changes.
func (s *RuntimeOverlayState) ReconcileAuthoritativeBase(
	base store.IndexData,
) (changed []RuntimeOverlay, removedOwnerIDs []string) {
	servers := map[string]string{}
	for _, definition := range base.Definitions {
		if definition.Kind == "mcp.server" {
			servers[definition.ID] = definition.Fingerprint
		}
	}
	for ownerID, overlay := range s.byOwner {
		fingerprint, exists := servers[ownerID]
		if !exists {
			delete(s.byOwner, ownerID)
			removedOwnerIDs = append(removedOwnerIDs, ownerID)
			continue
		}
		if overlay.OwnerFingerprint == fingerprint {
			continue
		}
		staleActiveDefinitions(overlay.Definitions)
		overlay.OwnerFingerprint = fingerprint
		s.byOwner[ownerID] = overlay
		changed = append(changed, overlay)
	}
	return changed, removedOwnerIDs
}

// IsEmpty reports whether runtime persistence has been hydrated or updated.
func (s *RuntimeOverlayState) IsEmpty() bool {
	return len(s.byOwner) == 0
}

// Apply validates and atomically applies one complete runtime operation.
func (s *RuntimeOverlayState) Apply(update ProjectIndexRuntimeUpdate) error {
	switch update.Operation {
	case RuntimeUpdateReplace:
		return s.applyReplace(update)
	case RuntimeUpdateFailure:
		return s.applyFailure(update)
	default:
		return fmt.Errorf("unsupported runtime update operation %q", update.Operation)
	}
}

// ValidateRuntimeUpdate checks the operation without mutating overlay state.
func ValidateRuntimeUpdate(update ProjectIndexRuntimeUpdate) error {
	switch update.Operation {
	case RuntimeUpdateReplace:
		return validateRuntimeReplace(update)
	case RuntimeUpdateFailure:
		return validateRuntimeFailure(update)
	default:
		return fmt.Errorf("unsupported runtime update operation %q", update.Operation)
	}
}

func (s *RuntimeOverlayState) applyReplace(update ProjectIndexRuntimeUpdate) error {
	if err := validateRuntimeReplace(update); err != nil {
		return err
	}
	previous := s.byOwner[update.Owner.DefinitionID]
	next := RuntimeOverlay{
		Owner: update.Owner, ObservedAt: update.ObservedAt, Revision: update.Revision,
		LastSuccessfulDiscovery: successfulDiscovery(update),
	}
	currentIDs := map[string]bool{}
	for _, definition := range update.Definitions {
		definition.Status = "active"
		currentIDs[definition.ID] = true
		next.Definitions = append(next.Definitions, definition)
	}
	for _, definition := range previous.Definitions {
		if currentIDs[definition.ID] {
			continue
		}
		next.Definitions = append(next.Definitions, compactMCPToolTombstone(definition))
	}
	next.Relations = append([]store.ProjectRelation(nil), update.Relations...)
	for _, relation := range previous.Relations {
		if currentIDs[relation.To] || hasRuntimeRelation(next.Relations, relation) {
			continue
		}
		next.Relations = append(next.Relations, relation)
	}
	s.byOwner[update.Owner.DefinitionID] = next
	return nil
}

func (s *RuntimeOverlayState) applyFailure(update ProjectIndexRuntimeUpdate) error {
	if err := validateRuntimeFailure(update); err != nil {
		return err
	}
	previous := s.byOwner[update.Owner.DefinitionID]
	next := RuntimeOverlay{
		Owner: update.Owner, ObservedAt: update.ObservedAt, Revision: previous.Revision,
		Error: update.Error, Definitions: append([]store.ProjectDefinition(nil), previous.Definitions...),
		Relations:               append([]store.ProjectRelation(nil), previous.Relations...),
		LastSuccessfulDiscovery: previous.LastSuccessfulDiscovery,
	}
	staleActiveDefinitions(next.Definitions)
	s.byOwner[update.Owner.DefinitionID] = next
	return nil
}

func staleActiveDefinitions(definitions []store.ProjectDefinition) {
	for index, definition := range definitions {
		if definition.Status == "active" {
			definitions[index].Status = "stale"
		}
	}
}
