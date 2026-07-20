package screens

import (
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func cancelPendingResource[T any](invalidations bridge.Invalidations, name bridge.ResourceName, owned *resource.Resource[T]) {
	snapshot := owned.Snapshot()
	if snapshot.State != resource.ResourceLoading && !snapshot.Refreshing {
		return
	}
	invalidations.Add(name, snapshot.Token.Revision)
	owned.Cancel()
}
