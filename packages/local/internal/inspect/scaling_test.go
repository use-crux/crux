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
		got.RecentRuns = append(got.RecentRuns, run.OperationID)
	}
	assertInspectGoldenJSON(t, "testdata/overview_generation.golden.json", got)
}

func TestProjectedReadModelCachesAreIsolatedAndRevisionAligned(t *testing.T) {
	ctx := context.Background()
	obs := newInspectBenchmarkObservability(t)
	service := NewService(store.NewStore(), t.TempDir()).WithObservability(obs)

	runs, err := service.Runs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) == 0 || runs[0].DurationMs == nil {
		t.Fatal("run fixture did not project a duration")
	}
	originalDuration := *runs[0].DurationMs
	*runs[0].DurationMs = -1
	isolatedRuns, err := service.Runs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if isolatedRuns[0].DurationMs == nil || *isolatedRuns[0].DurationMs != originalDuration {
		t.Fatal("caller mutation leaked into the projected run cache")
	}

	column := 7
	cachedInsights := []inspectInsightRecord{{
		Trend: []float64{1},
		LinkedSources: []store.SourceLoc{{
			File: "source.ts", Column: &column,
		}},
		DetailStats: &inspectInsightDetailStats{
			CostSpark: []float64{2},
		},
	}}
	isolatedInsights := cloneInspectInsightRecords(cachedInsights)
	isolatedInsights[0].Trend[0] = -1
	*isolatedInsights[0].LinkedSources[0].Column = -1
	isolatedInsights[0].DetailStats.CostSpark[0] = -1
	if cachedInsights[0].Trend[0] != 1 || *cachedInsights[0].LinkedSources[0].Column != 7 || cachedInsights[0].DetailStats.CostSpark[0] != 2 {
		t.Fatal("caller mutation leaked through the projected insight clone")
	}

	if _, err := service.Insights(ctx); err != nil {
		t.Fatal(err)
	}
	beforeRevision := service.insightsRevision
	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"schemaVersion":5,"records":[{"schemaVersion":5,"recordId":"cache-revision-start","type":"run:start","runId":"cache-revision","operationId":"cache-revision","segmentId":"cache-revision-segment","segmentSeq":1,"traceId":"cache-revision-trace","name":"cache revision","rootPrimitive":"agent.run","startedAt":"2026-05-16T19:00:00.000Z","status":"running"}]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Insights(ctx); err != nil {
		t.Fatal(err)
	}
	if service.insightsRevision <= beforeRevision || service.insightsRevision != service.runsRevision {
		t.Fatalf("cache revisions insights/runs = %d/%d, previous %d", service.insightsRevision, service.runsRevision, beforeRevision)
	}
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

func BenchmarkScaleStoreInspectReadPaths(b *testing.B) {
	path := os.Getenv("CRUX_SCALE_DB")
	project := os.Getenv("CRUX_SCALE_PROJECT")
	if path == "" || project == "" {
		b.Skip("CRUX_SCALE_DB and CRUX_SCALE_PROJECT are not set")
	}
	obs, err := observability.OpenService(context.Background(), path)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := obs.Close(); err != nil {
			b.Fatal(err)
		}
	})
	service := NewService(store.NewStore(), project).WithObservability(obs)

	b.Run("overview", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			if _, err := service.OverviewRecordAPI(context.Background()); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("runs", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			if _, err := service.Runs(context.Background()); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("insights", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			if _, err := service.Insights(context.Background()); err != nil {
				b.Fatal(err)
			}
		}
	})
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
