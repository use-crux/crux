package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

var indexSnapshotOwner = resource.ResourceOwner{Screen: "index", Resource: "snapshot"}
var indexWatchOwner = resource.ResourceOwner{Screen: "index", Resource: "watch"}
var indexActivityOwner = resource.ResourceOwner{Screen: "index", Resource: "definition-activity"}

func indexActivityOwnerForDefinition(definitionID string) resource.ResourceOwner {
	owner := indexActivityOwner
	owner.RecordID = definitionID
	return owner
}

type indexLoadedMsg resource.ResourceResult[api.IndexData]
type indexWatchLoadedMsg resource.ResourceResult[api.ProjectIndexWatchStatus]
type indexActivityLoadedMsg resource.ResourceResult[api.CatalogRuntimeActivityV1]

func (m indexLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[api.IndexData](m).Token.Owner
}

func (m indexWatchLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[api.ProjectIndexWatchStatus](m).Token.Owner
}

func (m indexActivityLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[api.CatalogRuntimeActivityV1](m).Token.Owner
}

func (s *Index) fetchIndex(parent context.Context, client DataClient) tea.Cmd {
	return s.fetchIndexAtRevision(parent, client, 0)
}

func (s *Index) fetchWatchStatus(parent context.Context, client DataClient) tea.Cmd {
	if client == nil {
		return nil
	}
	ctx, token := s.watch.Begin(parent, indexWatchOwner, 0)
	return func() tea.Msg {
		value, err := client.ProjectIndexWatchStatus(ctx)
		return indexWatchLoadedMsg(resource.ResourceResult[api.ProjectIndexWatchStatus]{
			Token: token, Value: value, Err: err,
		})
	}
}

func (s *Index) fetchDefinitionActivity(parent context.Context, client DataClient) tea.Cmd {
	definitionID := s.SelectedDefinitionID()
	if client == nil || definitionID == "" {
		return nil
	}
	owner := indexActivityOwnerForDefinition(definitionID)
	ctx, token := s.activity.Begin(parent, owner, 0)
	return func() tea.Msg {
		value, err := client.DefinitionActivity(ctx, definitionID)
		return indexActivityLoadedMsg(resource.ResourceResult[api.CatalogRuntimeActivityV1]{
			Token: token, Value: value, Err: err,
		})
	}
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
