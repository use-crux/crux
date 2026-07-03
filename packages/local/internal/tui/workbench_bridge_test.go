package tui

import (
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

func TestWorkbenchBridgeBatchMarksInactiveScreenStaleUntilFocus(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	active := &fakeScreen{id: "overview", interest: bridge.NewDomains(bridge.DomainRuns)}
	inactive := &fakeScreen{id: "insights", interest: bridge.NewDomains(bridge.DomainInsights)}
	w.screens["overview"] = active
	w.screens["insights"] = inactive
	w.activeNav = "overview"

	cmd := w.Update(bridge.Batch{Changed: bridge.NewDomains(bridge.DomainInsights)})
	runCmd(cmd)
	if len(active.updateMsgs) != 0 {
		t.Fatalf("active screen received uninterested bridge batch: %d update(s)", len(active.updateMsgs))
	}
	if inactive.initCalls != 0 || len(inactive.updateMsgs) != 0 {
		t.Fatalf("inactive screen fetched or updated on bridge batch: init=%d updates=%d", inactive.initCalls, len(inactive.updateMsgs))
	}

	runCmd(w.gotoNav("insights"))
	if inactive.initCalls != 1 {
		t.Fatalf("inactive screen init calls after focus = %d, want 1", inactive.initCalls)
	}
}

func TestWorkbenchGotoNavDoesNotRefetchCleanInitializedScreen(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	overview := &fakeScreen{id: "overview", interest: bridge.NewDomains(bridge.DomainRuns)}
	insights := &fakeScreen{id: "insights", interest: bridge.NewDomains(bridge.DomainInsights)}
	w.screens["overview"] = overview
	w.screens["insights"] = insights
	w.activeNav = "overview"

	runCmd(w.gotoNav("insights"))
	if insights.initCalls != 1 {
		t.Fatalf("first insights focus init calls = %d, want 1", insights.initCalls)
	}
	runCmd(w.gotoNav("overview"))
	runCmd(w.gotoNav("insights"))
	if insights.initCalls != 1 {
		t.Fatalf("clean second insights focus init calls = %d, want still 1", insights.initCalls)
	}

	runCmd(w.gotoNav("overview"))
	runCmd(w.Update(bridge.Batch{Changed: bridge.NewDomains(bridge.DomainInsights)}))
	runCmd(w.gotoNav("insights"))
	if insights.initCalls != 2 {
		t.Fatalf("stale insights focus init calls = %d, want 2", insights.initCalls)
	}
}

func runCmd(cmd tea.Cmd) tea.Msg {
	if cmd == nil {
		return nil
	}
	return cmd()
}
