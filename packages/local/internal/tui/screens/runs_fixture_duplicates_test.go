package screens

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestDemoFixtureProducesCollapsibleDuplicateToolGroupThroughIngest(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "..", "fixtures", "demo-project", "observability-batch.v4.json"))
	if err != nil {
		t.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal(body, &batch); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "observability.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service, err := observability.NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(context.Background(), batch); err != nil {
		t.Fatal(err)
	}
	page, err := service.RunsPage(context.Background(), observability.RunListOptions{
		Limit:                   100,
		IncludeExpensiveRollups: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	sessions := map[string]bool{}
	var flow *observability.RunSummary
	for index := range page.Rows {
		sessions[page.Rows[index].SessionID] = true
		if page.Rows[index].RunID == "run_demo_refund_flow" {
			flow = &page.Rows[index]
		}
	}
	if !sessions["session_demo_support"] || !sessions["session_demo_billing"] {
		t.Fatalf("fixture sessions = %+v, want support and billing", sessions)
	}
	if flow == nil || flow.FailedChildCount != 1 {
		t.Fatalf("fixture flow topology = %+v, want one failed child", flow)
	}
	detail, err := service.RunDetail(context.Background(), "run_demo_support_regression")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	var projected api.ObservabilityRunDetail
	if err := json.Unmarshal(encoded, &projected); err != nil {
		t.Fatal(err)
	}

	spans := inspectSpansFromRunDetailNode(projected.Root)
	rows := FlattenRun(spans, nil)
	found := false
	for _, row := range rows {
		if strings.Contains(row.Span.Name, "more searchPolicies") {
			found = true
			if !row.Expandable || row.ExpansionID == "" {
				t.Fatalf("duplicate row is not expandable: %#v", row)
			}
		}
	}
	if !found {
		t.Fatalf("ingested regression run did not produce a collapsed searchPolicies group: %#v", rows)
	}
}
