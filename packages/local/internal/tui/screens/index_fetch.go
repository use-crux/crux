package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

var indexSnapshotOwner = resource.ResourceOwner{Screen: "index", Resource: "snapshot"}

type indexLoadedMsg resource.ResourceResult[api.IndexData]

func (m indexLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[api.IndexData](m).Token.Owner
}

func (s *Index) fetchIndex(parent context.Context, client DataClient) tea.Cmd {
	return s.fetchIndexAtRevision(parent, client, 0)
}

func (s *Index) fetchIndexAtRevision(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	if client == nil {
		return nil
	}
	snapshot := s.snapshot.Snapshot()
	ctx, token := s.snapshot.Begin(parent, indexSnapshotOwner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return func() tea.Msg {
		value, err := client.ProjectIndex(ctx)
		return indexLoadedMsg(resource.ResourceResult[api.IndexData]{Token: token, Value: value, Err: err})
	}
}
