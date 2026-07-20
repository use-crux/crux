package tui

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestWorkbenchDoesNotProjectIndexOrContextEventsIntoOverviewActivity(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	w.Resize(140, 36)
	runWorkbenchCommands(w, w.Init())

	w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{
			{Kind: "index", RefID: "index-only-ref"},
			{Kind: "context", RefID: "context-only-ref"},
		},
		Changed: bridge.NewDomains(bridge.DomainIndex, bridge.DomainContext),
	})

	view := w.View()
	for _, ref := range []string{"index-only-ref", "context-only-ref"} {
		if strings.Contains(view, ref) {
			t.Fatalf("Overview activity projected non-activity event %q:\n%s", ref, view)
		}
	}
}

func TestWorkbenchProjectsOnlyActivityEventsFromMixedBatch(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	w.Resize(140, 36)
	runWorkbenchCommands(w, w.Init())

	w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{
			{Kind: "index", RefID: "mixed-index-ref"},
			{Kind: "run", RefID: "mixed-run-ref"},
		},
		Changed: bridge.NewDomains(bridge.DomainIndex, bridge.DomainRuns, bridge.DomainActivity),
	})

	view := w.View()
	if strings.Contains(view, "mixed-index-ref") || !strings.Contains(view, "mixed-run-ref") {
		t.Fatalf("mixed batch activity projection was not domain-filtered:\n%s", view)
	}
}
