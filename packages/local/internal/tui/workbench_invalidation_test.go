package tui

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type detailInvalidationClient struct {
	*uitest.FixtureClient
	detailIDs []string
}

func (c *detailInvalidationClient) ObservabilityRunDetail(_ context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	c.detailIDs = append(c.detailIDs, runID)
	return api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: runID},
		Root: api.ObservabilityRunDetailNode{ID: "root-" + runID},
	}, true, nil
}

func TestInvalidationsForBatchUsesExactObservabilityServerRevision(t *testing.T) {
	payload, err := json.Marshal(map[string]any{"runId": "run-a", "revision": 8})
	if err != nil {
		t.Fatal(err)
	}
	invalidations := invalidationsForBatch(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "observability.records", RefID: "run-a", Payload: payload}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
		Revs:    bridge.Revisions{Runs: 99, Activity: 99},
	})

	if revision, ok := invalidations.Revision(bridge.RunsListResource); !ok || revision != 8 {
		t.Fatalf("runs:list invalidation = (%d, %v), want server revision 8", revision, ok)
	}
	if revision, ok := invalidations.Revision(bridge.RunsDetailResource("run-a")); !ok || revision != 8 {
		t.Fatalf("runs:detail:run-a invalidation = (%d, %v), want server revision 8", revision, ok)
	}
}

func TestInvalidationsForBatchNeverUseBridgeRunCounterAsServerFloor(t *testing.T) {
	invalidations := invalidationsForBatch(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "run", RefID: "run-a"}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
		Revs:    bridge.Revisions{Runs: 999, Activity: 999},
	})

	if revision, ok := invalidations.Revision(bridge.RunsListResource); !ok || revision != 0 {
		t.Fatalf("runs:list invalidation = (%d, %v), want unknown server floor 0", revision, ok)
	}
	if revision, ok := invalidations.Revision(bridge.RunsDetailResource("run-a")); !ok || revision != 0 {
		t.Fatalf("runs:detail:run-a invalidation = (%d, %v), want unknown server floor 0", revision, ok)
	}
}

func TestInvalidationsForBatchTargetsEveryDeletedRunDetail(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"runIds":   []string{"run-a", "run-b", "run-a"},
		"revision": 12,
	})
	if err != nil {
		t.Fatal(err)
	}
	invalidations := invalidationsForBatch(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "observability.records", Action: "deleted", Payload: payload}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
		Revs:    bridge.Revisions{Runs: 999, Activity: 999},
	})

	for _, name := range []bridge.ResourceName{
		bridge.RunsListResource,
		bridge.RunsDetailResource("run-a"),
		bridge.RunsDetailResource("run-b"),
	} {
		if revision, ok := invalidations.Revision(name); !ok || revision != 12 {
			t.Fatalf("%s invalidation = (%d, %v), want server revision 12", name, revision, ok)
		}
	}
	if _, wildcard := invalidations.Revision(bridge.RunsAnyDetailResource); wildcard {
		t.Fatal("exact multi-run deletion also emitted a wildcard detail invalidation")
	}
}

func TestInvalidationsForBatchUsesWildcardOnlyWhenRunIdentityIsUnknown(t *testing.T) {
	invalidations := invalidationsForBatch(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "run", Action: "changed"}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
	})
	if _, ok := invalidations.Revision(bridge.RunsAnyDetailResource); !ok {
		t.Fatal("unknown run identity did not invalidate the active detail wildcard")
	}
}

func TestObservabilityRefreshBatchRefInvalidatesAnotherSelectedRun(t *testing.T) {
	client := &detailInvalidationClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	runWorkbenchCommands(w, w.Init())
	runWorkbenchCommands(w, w.gotoTarget(NavTarget{NavID: "runs", Kind: KindRun, ID: "run-b"}))
	client.detailIDs = nil

	runWorkbenchCommands(w, w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "refresh", Action: "observability ingested", RefID: "run-a"}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
	}))

	if len(client.detailIDs) != 1 || client.detailIDs[0] != "run-b" {
		t.Fatalf("observability batch refreshed detail IDs %#v, want selected run-b", client.detailIDs)
	}
}

func TestObservabilityRefreshUsesExactDetailsWhenPayloadCarriesCompleteRunIDs(t *testing.T) {
	payload, err := json.Marshal(map[string]any{"runIds": []string{"run-a", "run-b"}, "revision": 14})
	if err != nil {
		t.Fatal(err)
	}
	invalidations := invalidationsForBatch(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "refresh", Action: "observability ingested", RefID: "run-a", Payload: payload}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
	})

	for _, runID := range []string{"run-a", "run-b"} {
		if revision, ok := invalidations.Revision(bridge.RunsDetailResource(runID)); !ok || revision != 14 {
			t.Fatalf("exact detail %s invalidation = (%d, %v), want revision 14", runID, revision, ok)
		}
	}
	if _, wildcard := invalidations.Revision(bridge.RunsAnyDetailResource); wildcard {
		t.Fatal("complete runIds payload emitted an unnecessary detail wildcard")
	}
}
