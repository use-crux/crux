package screens

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func TestOverviewActivityOverlayPreservesNonAdjacentAuthoritativeOccurrences(t *testing.T) {
	overview := NewOverview()
	authoritative := []api.InspectActivityEvent{
		{Timestamp: 300, Kind: "run", RefID: "run-a"},
		{Timestamp: 200, Kind: "insight", RefID: "insight-x"},
		{Timestamp: 100, Kind: "run", RefID: "run-a"},
	}
	_, token := overview.activityResource.Begin(testContext, overviewActivityOwner, 1)
	overview.Update(testContext, activityLoadedMsg(resource.ResourceResult[[]api.InspectActivityEvent]{
		Token: token,
		Value: authoritative,
	}), nil)

	rows := overview.projectedActivityRows()
	if len(rows) != 3 {
		t.Fatalf("projected authoritative occurrences = %#v, want all three non-adjacent rows", rows)
	}
	if rows[0].Timestamp != 300 || rows[1].Timestamp != 200 || rows[2].Timestamp != 100 {
		t.Fatalf("projected authoritative timestamps = %#v, want 300, 200, 100", rows)
	}
}

func TestOverviewActivityPayloadReconcilesAcrossEnvelopeTimestamp(t *testing.T) {
	overview := NewOverview()
	authoritative := api.InspectActivityEvent{
		Tag:       "InspectActivityEvent",
		Timestamp: 100,
		Kind:      "run",
		Severity:  "error",
		Summary:   "authoritative run failure",
		RefID:     "run-a",
	}
	payload, err := json.Marshal(authoritative)
	if err != nil {
		t.Fatal(err)
	}
	overview.Update(testContext, LiveEvents{Events: []api.InspectEvent{{
		Timestamp: 200,
		Kind:      "run",
		Action:    "activity",
		Severity:  "error",
		RefID:     "run-a",
		Payload:   payload,
	}}}, nil)

	_, token := overview.activityResource.Begin(testContext, overviewActivityOwner, 1)
	overview.Update(testContext, activityLoadedMsg(resource.ResourceResult[[]api.InspectActivityEvent]{
		Token: token,
		Value: []api.InspectActivityEvent{authoritative},
	}), nil)

	rows := overview.projectedActivityRows()
	if len(rows) != 1 {
		t.Fatalf("reconciled activity rows = %#v, want one authoritative occurrence", rows)
	}
	if rows[0].Timestamp != 100 || rows[0].Summary != authoritative.Summary || rows[0].Severity != "error" {
		t.Fatalf("reconciled activity = %#v, want authoritative payload %#v", rows[0], authoritative)
	}
}

func TestOverviewOlderAuthoritativeOccurrenceDoesNotReconcileNewerLiveEvent(t *testing.T) {
	overview := NewOverview()
	oldAuthoritative := []api.InspectActivityEvent{
		{Timestamp: 150, Kind: "insight", RefID: "insight-x"},
		{Timestamp: 100, Kind: "run", RefID: "run-a"},
	}
	_, initialToken := overview.activityResource.Begin(testContext, overviewActivityOwner, 1)
	overview.Update(testContext, activityLoadedMsg(resource.ResourceResult[[]api.InspectActivityEvent]{
		Token: initialToken,
		Value: oldAuthoritative,
	}), nil)
	overview.Update(testContext, LiveEvents{Events: []api.InspectEvent{
		{Timestamp: 200, Kind: "run", RefID: "run-a"},
	}}, nil)

	_, refreshToken := overview.activityResource.Begin(testContext, overviewActivityOwner, 2)
	overview.Update(testContext, activityLoadedMsg(resource.ResourceResult[[]api.InspectActivityEvent]{
		Token: refreshToken,
		Value: oldAuthoritative,
	}), nil)

	rows := overview.projectedActivityRows()
	if len(rows) != 3 {
		t.Fatalf("projected live plus authoritative occurrences = %#v, want three rows", rows)
	}
	if rows[0].Timestamp != 200 || rows[1].Timestamp != 150 || rows[2].Timestamp != 100 {
		t.Fatalf("projected timestamps = %#v, want live 200 then authoritative 150, 100", rows)
	}
}
