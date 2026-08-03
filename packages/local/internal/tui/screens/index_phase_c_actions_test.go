package screens

import (
	"context"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func TestIndexRelationEnterUsesExactDefinitionNavigation(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{
		Definitions: []api.ProjectDefinition{
			{ID: "prompt:source", Kind: "prompt", Name: "source"},
			{ID: "context:target", Kind: "context", Name: "target"},
		},
		Relations: []api.ProjectRelation{{
			Type: "prompt.uses_context", From: "prompt:source", To: "context:target",
		}},
	})
	index.Resize(Size{Width: 100, Height: 30})

	index.Update(testContext, tea.KeyPressMsg{Code: tea.KeyEnter}, nil)
	if index.focus != indexFocusDetail {
		t.Fatal("first Enter did not focus Index detail")
	}
	cmd := index.Update(testContext, tea.KeyPressMsg{Code: tea.KeyEnter}, nil)
	if cmd == nil {
		t.Fatal("relation Enter did not emit exact navigation")
	}
	if got, want := cmd(), (NavigateRequest{NavID: "index", Kind: "definition", ID: "context:target"}); got != want {
		t.Fatalf("relation Enter = %#v, want %#v", got, want)
	}
}

func TestIndexRuntimeJoinAndWatchStatusExposeTypedActions(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	previousNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = previousNow }()

	index := NewIndex()
	index.SetIndexForTest(api.IndexData{
		Indexing: &api.ProjectIndexingStatus{
			Status:   "ready",
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{ID: "prompt:runtime", Kind: "prompt", Name: "runtime"}},
	})
	_, watchToken := index.watch.Begin(context.Background(), indexWatchOwner, 0)
	index.watch.Apply(resource.ResourceResult[api.ProjectIndexWatchStatus]{
		Token: watchToken, Value: api.ProjectIndexWatchStatus{State: "idle"},
	})
	activityOwner := indexActivityOwner
	activityOwner.RecordID = "prompt:runtime"
	_, activityToken := index.activity.Begin(context.Background(), activityOwner, 0)
	index.activity.Apply(resource.ResourceResult[api.CatalogRuntimeActivityV1]{
		Token: activityToken,
		Value: api.CatalogRuntimeActivityV1{
			DefinitionID: "prompt:runtime", RunCount: 2, LastRunID: "run:latest",
			LastRunAt: now.Add(-5 * time.Minute).Format(time.RFC3339), LastStatus: "failed",
		},
	})
	index.Resize(Size{Width: 120, Height: 30})
	index.syncDetail()

	view := stripANSI(index.View(Size{}))
	for _, want := range []string{"index ready", "semantic ok", "watch idle", "last run 5m · 2 runs · failed"} {
		if !strings.Contains(view, want) {
			t.Fatalf("runtime/status projection omitted %q:\n%s", want, view)
		}
	}
	cmd := index.Update(testContext, tea.KeyPressMsg{Text: "r", Code: 'r'}, nil)
	if cmd == nil {
		t.Fatal("runtime join did not advertise an executable Runs jump")
	}
	if got, want := cmd(), (NavigateRequest{NavID: "runs", Kind: "definition", ID: "prompt:runtime"}); got != want {
		t.Fatalf("runtime jump = %#v, want %#v", got, want)
	}
}

func TestIndexCompactHeaderPreservesWholeStatusNames(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{
		Indexing: &api.ProjectIndexingStatus{
			Status:   "ready",
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{ID: "prompt:compact", Kind: "prompt", Name: "compact"}},
	})
	index.Resize(Size{Width: 44, Height: 20})

	view := stripANSI(index.renderList(44, 20))
	header := strings.Split(view, "\n")[1]
	for _, want := range []string{"Definitions", "index ready", "semantic ok"} {
		if !strings.Contains(header, want) {
			t.Fatalf("compact header omitted %q: %q", want, header)
		}
	}
	if strings.Contains(header, "index read…") || strings.Contains(header, "semantic o…") {
		t.Fatalf("compact header truncated a status name: %q", header)
	}
}

func TestIndexCompactHeaderShortensDegradedSemanticStateWithoutTruncating(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{
		Indexing: &api.ProjectIndexingStatus{
			Status:   "degraded",
			Semantic: api.IndexIndexingSemanticStatus{Status: "degraded"},
		},
		Definitions: []api.ProjectDefinition{{ID: "prompt:compact", Kind: "prompt", Name: "compact"}},
	})
	index.Resize(Size{Width: 44, Height: 20})

	header := strings.Split(stripANSI(index.renderList(44, 20)), "\n")[1]
	for _, want := range []string{"index degraded", "semantic warn"} {
		if !strings.Contains(header, want) {
			t.Fatalf("compact degraded header omitted %q: %q", want, header)
		}
	}
	if strings.Contains(header, "…") {
		t.Fatalf("compact degraded header truncated status: %q", header)
	}
}

func TestIndexGroupAxisTogglesBetweenKindAndFile(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{
		ProjectRoot: "/repo",
		Definitions: []api.ProjectDefinition{
			{ID: "prompt:a", Kind: "prompt", Name: "a", Source: &api.SourceLoc{File: "/repo/src/a.ts"}},
			{ID: "tool:b", Kind: "tool", Name: "b", Source: &api.SourceLoc{File: "/repo/src/b.ts"}},
			{ID: "context:c", Kind: "context", Name: "c", Source: &api.SourceLoc{File: "/repo/src/a.ts"}},
		},
	})
	index.Resize(Size{Width: 70, Height: 24})
	index.Update(testContext, tea.KeyPressMsg{Text: "v", Code: 'v'}, nil)

	view := stripANSI(index.View(Size{}))
	for _, want := range []string{"by file", "SRC/A.TS 2", "SRC/B.TS 1"} {
		if !strings.Contains(view, want) {
			t.Fatalf("file grouping omitted %q:\n%s", want, view)
		}
	}
}
