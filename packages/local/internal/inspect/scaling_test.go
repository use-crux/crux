package inspect

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type overviewGolden struct {
	RunCount     int      `json:"runCount"`
	InsightCount int      `json:"insightCount"`
	TotalCost    float64  `json:"totalCost"`
	CostPer100   *float64 `json:"costPer100Runs,omitempty"`
	P50LatencyMs *float64 `json:"p50LatencyMs,omitempty"`
	P95LatencyMs *float64 `json:"p95LatencyMs,omitempty"`
	RecentRuns   []string `json:"recentRuns"`
}

func TestOverviewReadModelGolden(t *testing.T) {
	ctx := context.Background()
	obs := newInspectBenchmarkObservability(t)
	service := NewService(store.NewStore(), t.TempDir()).WithObservability(obs)

	overview, err := service.OverviewRecordAPI(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := overviewGolden{
		RunCount:     overview.RunCount,
		InsightCount: overview.InsightCount,
		TotalCost:    overview.TotalCost,
		CostPer100:   overview.CostPer100Runs,
		P50LatencyMs: overview.P50LatencyMs,
		P95LatencyMs: overview.P95LatencyMs,
	}
	for _, run := range overview.RecentRuns {
		got.RecentRuns = append(got.RecentRuns, run.TraceID)
	}
	assertInspectGoldenJSON(t, "testdata/overview_generation.golden.json", got)
}

func BenchmarkServiceOverviewFromObservability(b *testing.B) {
	obs := newInspectBenchmarkObservability(b)
	service := NewService(store.NewStore(), b.TempDir()).WithObservability(obs)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := service.OverviewRecordAPI(context.Background()); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkServiceRunsFromObservability(b *testing.B) {
	obs := newInspectBenchmarkObservability(b)
	service := NewService(store.NewStore(), b.TempDir()).WithObservability(obs)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := service.Runs(context.Background()); err != nil {
			b.Fatal(err)
		}
	}
}

func newInspectBenchmarkObservability(tb testing.TB) *observability.Service {
	tb.Helper()
	obs, err := observability.OpenService(context.Background(), ":memory:")
	if err != nil {
		tb.Fatal(err)
	}
	tb.Cleanup(func() {
		if err := obs.Close(); err != nil {
			tb.Fatal(err)
		}
	})
	raw, err := os.ReadFile("../../../core/src/observability/fixtures/generation-run.json")
	if err != nil {
		tb.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		tb.Fatal(err)
	}
	if err := obs.Ingest(context.Background(), batch); err != nil {
		tb.Fatal(err)
	}
	return obs
}

func assertInspectGoldenJSON(t *testing.T, path string, got any) {
	t.Helper()
	data, err := json.MarshalIndent(got, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(want) {
		t.Fatalf("golden mismatch for %s\n got:\n%s\nwant:\n%s", path, data, want)
	}
}
