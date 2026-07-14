package cache

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// Cache owns best-effort local Project Index snapshot caching for service runs.
//
// Direct FactStore operations remain strict. Cache writes during indexing are
// intentionally best-effort so read-only or fake project roots do not fail an
// otherwise valid source indexing run.
type Cache struct {
	facts  FactStore
	strict bool
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
