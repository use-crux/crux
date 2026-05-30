package devtools

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"

	_ "modernc.org/sqlite"
)

func TestServiceStatsRoutesPreferObservability(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	obs, err := observability.NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile("../../../core/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal(fixture, &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), quality.NewService(store.NewStore(), t.TempDir())).WithObservability(obs)

	statsValue, found, err := service.Get(ctx, "/api/stats", nil)
	if err != nil || !found {
		t.Fatalf("/api/stats found=%v err=%v", found, err)
	}
	stats := statsValue.(store.StatsResult)
	if stats.TotalExecutions != 1 || stats.SuccessCount != 1 || stats.TotalTokens != 60 || stats.TotalCost != 0.00042 {
		t.Fatalf("stats = %#v", stats)
	}

	usageValue, found, err := service.Get(ctx, "/api/stats/prompt-usage", nil)
	if err != nil || !found {
		t.Fatalf("/api/stats/prompt-usage found=%v err=%v", found, err)
	}
	usage := usageValue.(map[string]store.PromptUsageStat)
	if usage["support.reply"].Count != 1 || usage["support.reply"].TotalCost != 0.00042 {
		t.Fatalf("prompt usage = %#v", usage)
	}

	sessionsValue, found, err := service.Get(ctx, "/api/sessions", nil)
	if err != nil || !found {
		t.Fatalf("/api/sessions found=%v err=%v", found, err)
	}
	sessions := sessionsValue.([]store.SessionInfo)
	if len(sessions) != 1 || sessions[0].SessionID != "default" || sessions[0].TraceCount != 1 {
		t.Fatalf("sessions = %#v", sessions)
	}
}
