package server

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestDirectClient_rejects_legacy_trace_routes(t *testing.T) {
	s := store.NewStore()
	client := devtools.NewDirectClient(s)

	var traces []any
	err := client.GetJSON(context.Background(), "/api/traces", &traces)
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("GetJSON(/api/traces) error = %v, want unsupported path", err)
	}
}

func TestDirectClient_reads_quality_routes_from_service(t *testing.T) {
	s := store.NewStore()
	qualitySvc := quality.NewService(s, t.TempDir())
	client := devtools.NewDirectClient(s, qualitySvc)

	var overview api.QualityOverviewRecord
	if err := client.GetJSON(context.Background(), "/api/quality/overview", &overview); err != nil {
		t.Fatalf("GetJSON(/api/quality/overview) error: %v", err)
	}
	if overview.Tag != "QualityOverview" {
		t.Fatalf("overview tag = %q, want QualityOverview", overview.Tag)
	}

	qualitySvc.Events().PublishActivity(api.QualityActivityEvent{
		Tag:      "QualityActivityEvent",
		Kind:     "trace",
		Severity: "info",
		RefID:    "t1",
		Summary:  "trace started",
	})
	var activity []api.QualityActivityEvent
	if err := client.GetJSON(context.Background(), "/api/quality/activity?limit=1", &activity); err != nil {
		t.Fatalf("GetJSON(/api/quality/activity) error: %v", err)
	}
	if len(activity) != 1 || activity[0].RefID != "t1" {
		t.Fatalf("activity = %+v, want one event for t1", activity)
	}
}
