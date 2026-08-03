package screens

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type indexResourceClient struct {
	*uitest.FixtureClient
	data  api.IndexData
	err   error
	calls int
	ctx   context.Context
}

func newIndexResourceClient(data api.IndexData) *indexResourceClient {
	return &indexResourceClient{FixtureClient: uitest.NewFixtureClient(), data: data}
}

func (c *indexResourceClient) ProjectIndex(ctx context.Context) (api.IndexData, error) {
	c.calls++
	c.ctx = ctx
	return c.data, c.err
}

func TestIndexRefreshFailureKeepsLastGoodDefinitions(t *testing.T) {
	client := newIndexResourceClient(sampleIndex())
	index := NewIndex()
	applyIndexCommand(t, index, index.Init(testContext, client), client)
	index.Resize(Size{Width: 100, Height: 24})

	client.err = errors.New("index worker temporarily unavailable")
	refresh := index.Refresh(testContext, client, bridge.Invalidations{bridge.IndexSnapshotResource: 1})
	applyIndexCommand(t, index, refresh, client)

	view := stripANSI(index.View(Size{Width: 100, Height: 24}))
	for _, want := range []string{"degraded", "index worker temporarily", "writer.prompt"} {
		if !strings.Contains(view, want) {
			t.Fatalf("degraded Index omitted %q while retaining last-good data:\n%s", want, view)
		}
	}
}

func TestIndexEmptyRefreshFailureIsDegraded(t *testing.T) {
	client := newIndexResourceClient(api.IndexData{})
	index := NewIndex()
	applyIndexCommand(t, index, index.Init(testContext, client), client)
	index.Resize(Size{Width: 100, Height: 24})

	client.err = errors.New("watcher disconnected")
	applyIndexCommand(t, index, index.Refresh(testContext, client, bridge.Invalidations{bridge.IndexSnapshotResource: 1}), client)

	view := stripANSI(index.View(Size{Width: 100, Height: 24}))
	for _, want := range []string{"degraded project index", "watcher disconnected", "no project definitions"} {
		if !strings.Contains(view, want) {
			t.Fatalf("empty last-good snapshot did not expose degraded state %q:\n%s", want, view)
		}
	}
}

func TestIndexRefreshesOnlyForIndexDomainEvents(t *testing.T) {
	client := newIndexResourceClient(sampleIndex())
	index := NewIndex()
	applyIndexCommand(t, index, index.Init(testContext, client), client)

	if cmd := index.Refresh(testContext, client, bridge.Invalidations{bridge.RunsListResource: 1}); cmd != nil {
		t.Fatal("unrelated run event scheduled a Project Index refresh")
	}
	if client.calls != 1 {
		t.Fatalf("ProjectIndex calls after unrelated event = %d, want 1", client.calls)
	}

	cmd := index.Refresh(testContext, client, bridge.Invalidations{bridge.IndexSnapshotResource: 1})
	applyIndexCommand(t, index, cmd, client)
	if client.calls != 2 {
		t.Fatalf("ProjectIndex calls after index event = %d, want 2", client.calls)
	}
}

func TestIndexFetchDescendsFromRootContext(t *testing.T) {
	client := newIndexResourceClient(sampleIndex())
	index := NewIndex()
	root, cancel := context.WithCancel(testContext)
	cmd := index.Init(root, client)
	cancel()
	applyIndexCommand(t, index, cmd, client)

	if client.ctx == nil || !errors.Is(client.ctx.Err(), context.Canceled) {
		t.Fatalf("ProjectIndex context error = %v, want root cancellation", client.ctx)
	}
}

func TestIndexRefreshPreservesSelectionAndDetailAnchor(t *testing.T) {
	sourceLines := make([]string, 40)
	for i := range sourceLines {
		sourceLines[i] = fmt.Sprintf("stable-source-line-%02d", i+1)
	}
	selected := api.ProjectDefinition{
		ID:       "prompt:selected",
		Kind:     "prompt",
		Name:     "selected",
		Fidelity: "resolved",
		SourceSnippet: &api.SourceSnippet{
			Source: strings.Join(sourceLines, "\n"),
			Range:  api.SourceRange{File: "src/selected.ts", StartLine: 1},
		},
	}
	client := newIndexResourceClient(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "tool:first", Kind: "tool", Name: "first"}, selected, {ID: "agent:last", Kind: "agent", Name: "last"},
	}})
	index := NewIndex()
	applyIndexCommand(t, index, index.Init(testContext, client), client)
	index.Resize(Size{Width: 100, Height: 18})
	index.definitions.Select(selected.ID)
	index.syncDetail()
	index.setFocus(indexFocusDetail)
	index.updateFocusedPane(tea.KeyPressMsg{Code: tea.KeyPgDown})
	before := index.detail.Position()
	if before.Offset == 0 {
		t.Fatal("test setup did not scroll the detail document")
	}

	selected.SourceSnippet.Source += "\nstable-source-line-41"
	client.data = api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "agent:last", Kind: "agent", Name: "last"}, {ID: "tool:first", Kind: "tool", Name: "first"}, selected,
	}}
	applyIndexCommand(t, index, index.Refresh(testContext, client, bridge.Invalidations{bridge.IndexSnapshotResource: 1}), client)

	if got := index.SelectedDefinitionID(); got != selected.ID {
		t.Fatalf("selection after reordered refresh = %q, want %q", got, selected.ID)
	}
	if after := index.detail.Position(); after.Offset != before.Offset {
		t.Fatalf("detail anchor after same-definition refresh = %d, want %d", after.Offset, before.Offset)
	}
}

func TestIndexViewIsStatePure(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(sampleIndex())
	index.Resize(Size{Width: 100, Height: 24})
	index.definitions.Select("agent:docs_agent")
	index.syncDetail()
	beforeList := index.definitions.Position()
	beforeDetail := index.detail.Position()
	beforeResource := index.snapshot.Snapshot()

	first := index.View(Size{Width: 59, Height: 10})
	second := index.View(Size{Width: 160, Height: 45})
	if first != second {
		t.Fatal("View reclassified from its argument instead of using prepared layout")
	}
	if got := index.definitions.Position(); got != beforeList {
		t.Fatalf("View mutated list position: before=%+v after=%+v", beforeList, got)
	}
	if got := index.detail.Position(); got != beforeDetail {
		t.Fatalf("View mutated detail position: before=%+v after=%+v", beforeDetail, got)
	}
	afterResource := index.snapshot.Snapshot()
	if afterResource.State != beforeResource.State || afterResource.Token != beforeResource.Token || afterResource.Refreshing != beforeResource.Refreshing {
		t.Fatalf("View mutated resource snapshot: before=%+v after=%+v", beforeResource, afterResource)
	}
}

func TestIndexResourceStatesRemainDistinct(t *testing.T) {
	client := newIndexResourceClient(sampleIndex())
	index := NewIndex()
	index.Resize(Size{Width: 100, Height: 24})
	initial := index.Init(testContext, client)
	if view := stripANSI(index.View(Size{})); !strings.Contains(view, "loading project index") {
		t.Fatalf("loading state missing:\n%s", view)
	}
	applyIndexCommand(t, index, initial, client)

	refresh := index.Init(testContext, client)
	refreshing := stripANSI(index.View(Size{}))
	for _, want := range []string{"refreshing", "writer.prompt"} {
		if !strings.Contains(refreshing, want) {
			t.Fatalf("refreshing state omitted %q or last-good rows:\n%s", want, refreshing)
		}
	}
	applyIndexCommand(t, index, refresh, client)

	failedClient := newIndexResourceClient(api.IndexData{})
	failedClient.err = errors.New("indexer offline")
	failed := NewIndex()
	failed.Resize(Size{Width: 100, Height: 24})
	applyIndexCommand(t, failed, failed.Init(testContext, failedClient), failedClient)
	if view := stripANSI(failed.View(Size{})); !strings.Contains(view, "failed project index: indexer offline") {
		t.Fatalf("failed state missing actionable error:\n%s", view)
	}
}

func TestIndexCoalescesInvalidationBehindActiveFetch(t *testing.T) {
	client := newIndexResourceClient(api.IndexData{Definitions: []api.ProjectDefinition{{ID: "prompt:old", Kind: "prompt", Name: "old"}}})
	index := NewIndex()
	oldRequest := index.Init(testContext, client)
	if cmd := index.Refresh(testContext, client, bridge.Invalidations{bridge.IndexSnapshotResource: 1}); cmd != nil {
		t.Fatal("active Index fetch was replaced instead of coalescing a trailing refresh")
	}

	oldResult := oldRequest()
	client.data = api.IndexData{Definitions: []api.ProjectDefinition{{ID: "prompt:new", Kind: "prompt", Name: "new"}}}
	trailingRefresh := index.Update(testContext, oldResult, client)
	batch, ok := trailingRefresh().(tea.BatchMsg)
	if !ok || len(batch) != 3 {
		t.Fatalf("completed Index fetch scheduled %#v, want activity, watch, and one trailing refresh", batch)
	}
	index.Update(testContext, batch[2](), client)

	if got := index.SelectedDefinitionID(); got != "prompt:new" {
		t.Fatalf("coalesced refresh retained %q, want newest snapshot", got)
	}
	if client.calls != 2 {
		t.Fatalf("ProjectIndex calls = %d, want one active plus one trailing refresh", client.calls)
	}
}

func TestIndexLateCanceledCompletionDoesNotConsumeNewerPendingRefresh(t *testing.T) {
	client := newIndexResourceClient(api.IndexData{Definitions: []api.ProjectDefinition{{ID: "prompt:old", Kind: "prompt", Name: "old"}}})
	index := NewIndex()
	oldRequest := index.Init(testContext, client)

	invalidations := index.Deactivate()
	currentRequest := index.Refresh(testContext, client, invalidations)
	if currentRequest == nil {
		t.Fatal("returning to Index did not start a replacement request")
	}
	if cmd := index.Refresh(testContext, client, bridge.Invalidations{bridge.IndexSnapshotResource: 2}); cmd != nil {
		t.Fatal("invalidation behind replacement request was not coalesced")
	}

	if cmd := index.Update(testContext, oldRequest(), client); cmd != nil {
		t.Fatal("late canceled completion scheduled work for the replacement request")
	}
	if !index.pendingSnapshotRefresh {
		t.Fatal("late canceled completion consumed the newer pending refresh")
	}

	client.data = api.IndexData{Definitions: []api.ProjectDefinition{{ID: "prompt:current", Kind: "prompt", Name: "current"}}}
	trailing := index.Update(testContext, currentRequest(), client)
	batch, ok := trailing().(tea.BatchMsg)
	if !ok || len(batch) != 3 {
		t.Fatalf("current completion scheduled %#v, want activity, watch, and trailing refresh", batch)
	}
}

func TestIndexSuccessfulRouteDoesNotOverrideManualSelectionOnRefresh(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "prompt:a", Kind: "prompt", Name: "a"},
		{ID: "prompt:routed", Kind: "prompt", Name: "routed"},
		{ID: "prompt:manual", Kind: "prompt", Name: "manual"},
	}})
	index.Focus("definition", "prompt:routed")
	index.Update(testContext, tea.KeyPressMsg{Text: "h", Code: 'h'}, nil)
	index.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	if got := index.SelectedDefinitionID(); got != "prompt:manual" {
		t.Fatalf("manual movement selected %q, want prompt:manual", got)
	}

	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "prompt:manual", Kind: "prompt", Name: "manual refreshed"},
		{ID: "prompt:routed", Kind: "prompt", Name: "routed"},
		{ID: "prompt:a", Kind: "prompt", Name: "a"},
	}})

	if got := index.SelectedDefinitionID(); got != "prompt:manual" {
		t.Fatalf("refresh snapped selection back to fulfilled route: %q", got)
	}
}

func TestIndexSuccessfulExactRouteBecomesExplicitMissWhenDefinitionDisappears(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "prompt:before", Kind: "prompt", Name: "same"},
		{ID: "prompt:routed", Kind: "prompt", Name: "same"},
		{ID: "prompt:after", Kind: "prompt", Name: "same"},
	}})
	index.Focus("definition", "prompt:routed")

	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "prompt:before", Kind: "prompt", Name: "same"},
		{ID: "prompt:after", Kind: "prompt", Name: "same"},
	}})

	if got := index.SelectedDefinitionID(); got != "" {
		t.Fatalf("disappeared routed definition selected substitute %q", got)
	}
	index.Resize(Size{Width: 70, Height: 21})
	view := stripANSI(index.View(Size{}))
	for _, want := range []string{"prompt:routed", "not in current index"} {
		if !strings.Contains(view, want) {
			t.Fatalf("disappeared routed definition omitted %q:\n%s", want, view)
		}
	}
}

func TestIndexUnresolvedRouteSelectsExactIDWhenLaterSnapshotContainsIt(t *testing.T) {
	index := NewIndex()
	index.Focus("definition", "prompt:later")
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{{ID: "prompt:other", Kind: "prompt", Name: "same"}}})
	if got := index.SelectedDefinitionID(); got != "" {
		t.Fatalf("unresolved route selected %q", got)
	}

	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "prompt:other", Kind: "prompt", Name: "same"},
		{ID: "prompt:later", Kind: "prompt", Name: "same"},
	}})
	if got := index.SelectedDefinitionID(); got != "prompt:later" {
		t.Fatalf("later snapshot selection = %q, want exact unresolved route", got)
	}
}

func applyIndexCommand(t *testing.T, index *Index, cmd tea.Cmd, client DataClient) {
	t.Helper()
	if cmd == nil {
		t.Fatal("expected Index fetch command")
	}
	index.Update(testContext, cmd(), client)
}
