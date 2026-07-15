package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type definitionEvidenceStore interface {
	DefinitionEvidence(context.Context, string, string) ([]model.IndexFactEnvelope, error)
}

// Cache owns best-effort local Project Index snapshot caching for service runs.
//
// Direct FactStore operations remain strict. Cache writes during indexing are
// intentionally best-effort so read-only or fake project roots do not fail an
// otherwise valid source indexing run.
type Cache struct {
	facts  FactStore
	strict bool
}

func (c *Cache) CommitRuntimeOverlay(ctx context.Context, root string, overlay model.RuntimeOverlay) error {
	store, ok := c.facts.(RuntimeOverlayStore)
	if !ok {
		return fmt.Errorf("project index fact store does not support runtime overlays")
	}
	return store.CommitRuntimeOverlay(ctx, root, overlay)
}

func (c *Cache) LoadRuntimeOverlays(ctx context.Context, root string) ([]model.RuntimeOverlay, error) {
	store, ok := c.facts.(RuntimeOverlayStore)
	if !ok {
		return nil, nil
	}
	return store.LoadRuntimeOverlays(ctx, root)
}

func (c *Cache) DeleteRuntimeOverlay(ctx context.Context, root, ownerDefinitionID string) error {
	store, ok := c.facts.(RuntimeOverlayStore)
	if !ok {
		return fmt.Errorf("project index fact store does not support runtime overlays")
	}
	return store.DeleteRuntimeOverlay(ctx, root, ownerDefinitionID)
}

func NewCache(facts FactStore, strict ...bool) *Cache {
	return &Cache{facts: facts, strict: len(strict) > 0 && strict[0]}
}

func (c *Cache) SetFactStore(facts FactStore) {
	if c == nil {
		return
	}
	c.facts = facts
}

func (c *Cache) LoadSnapshot(ctx context.Context, root, projectName string, loadedAt time.Time) (store.IndexData, bool, error) {
	if c == nil || c.facts == nil {
		return store.IndexData{}, false, nil
	}
	index, ok, err := c.facts.LoadSnapshot(ctx, root, projectName, loadedAt)
	if err != nil {
		if c.strict {
			return store.IndexData{}, false, err
		}
		return store.IndexData{}, false, nil
	}
	return index, ok, nil
}

func (c *Cache) Commit(ctx context.Context, patch IndexPatch) error {
	if c == nil || c.facts == nil {
		return nil
	}
	if err := c.facts.CommitPhase(ctx, FactTransactionFromPatch(patch)); err != nil {
		if c.strict {
			return err
		}
		return nil
	}
	return nil
}

// DefinitionEvidence returns durable provenance when the configured fact store
// supports explanation reads. Stores without that capability remain truthful
// by returning an empty evidence set.
func (c *Cache) DefinitionEvidence(ctx context.Context, root, definitionID string) ([]model.IndexFactEnvelope, error) {
	if c == nil || c.facts == nil {
		return []model.IndexFactEnvelope{}, nil
	}
	store, ok := c.facts.(definitionEvidenceStore)
	if !ok {
		return []model.IndexFactEnvelope{}, nil
	}
	return store.DefinitionEvidence(ctx, root, definitionID)
}
