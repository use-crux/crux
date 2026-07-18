package server

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestDirectClientRejectsLegacyTraceRoutes(t *testing.T) {
	client := devtools.NewDirectClient(store.NewStore())

	var traces []any
	err := client.GetJSON(context.Background(), "/api/traces", &traces)
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("GetJSON(/api/traces) error = %v, want unsupported path", err)
	}
}

func TestDirectClientReadsInspectionRoutesFromService(t *testing.T) {
	store := store.NewStore()
	service := inspect.NewService(store, t.TempDir())
	client := devtools.NewDirectClient(store, service)

	var overview api.InspectOverviewRecord
	if err := client.GetJSON(context.Background(), "/api/inspect/overview", &overview); err != nil {
		t.Fatalf("GetJSON(/api/inspect/overview) error: %v", err)
	}
	if overview.Tag != "InspectOverview" {
		t.Fatalf("overview tag = %q, want InspectOverview", overview.Tag)
	}

	service.Events().PublishActivity(api.InspectActivityEvent{
		Tag: "InspectActivityEvent", Kind: "trace", Severity: "info", RefID: "t1", Summary: "trace started",
	})
	var activity []api.InspectActivityEvent
	if err := client.GetJSON(context.Background(), "/api/inspect/activity?limit=1", &activity); err != nil {
		t.Fatalf("GetJSON(/api/inspect/activity) error: %v", err)
	}
	if len(activity) != 1 || activity[0].RefID != "t1" {
		t.Fatalf("activity = %+v, want one event for t1", activity)
	}
}
