package observability

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type runDetailGolden struct {
	RunID       string   `json:"runId"`
	Status      string   `json:"status"`
	RootKind    string   `json:"rootKind"`
	RootLabel   string   `json:"rootLabel"`
	RowLabels   []string `json:"rowLabels"`
	Primary     int      `json:"primary"`
	Detail      int      `json:"detail"`
	Metadata    int      `json:"metadata"`
	Diagnostics int      `json:"diagnostics"`
}

func TestRunDetailReadModelGolden(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := loadGenerationFixture(t)
	runID := generationFixtureRunID(t, batch)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	got := runDetailGolden{
		RunID:       detail.Run.RunID,
		Status:      detail.Run.Status,
		RootKind:    detail.Root.Kind,
		RootLabel:   detail.Root.Display.Label,
		Primary:     detail.Counts.Primary,
		Detail:      detail.Counts.Detail,
		Metadata:    detail.Counts.Metadata,
		Diagnostics: len(detail.Diagnostics),
	}
	for _, row := range detail.Rows {
		got.RowLabels = append(got.RowLabels, row.Display.Label)
	}
	assertGoldenJSON(t, "testdata/run_detail_generation.golden.json", got)
}

func BenchmarkServiceIngestGenerationFixture(b *testing.B) {
	batch := loadGenerationFixtureForBenchmark(b)
	for i := 0; i < b.N; i++ {
		service := newBenchmarkService(b)
		if err := service.Ingest(context.Background(), batch); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkServiceRunsGenerationFixture(b *testing.B) {
	service := newBenchmarkService(b)
	if err := service.Ingest(context.Background(), loadGenerationFixtureForBenchmark(b)); err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := service.Runs(context.Background()); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkServiceRunDetailGenerationFixture(b *testing.B) {
	service := newBenchmarkService(b)
	batch := loadGenerationFixtureForBenchmark(b)
	runID := benchmarkFixtureRunID(b, batch)
	if err := service.Ingest(context.Background(), batch); err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := service.RunDetail(context.Background(), runID); err != nil {
			b.Fatal(err)
		}
	}
}

func newBenchmarkService(b *testing.B) *Service {
	b.Helper()
	service, err := OpenService(context.Background(), ":memory:")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := service.Close(); err != nil {
			b.Fatal(err)
		}
	})
	return service
}

func loadGenerationFixtureForBenchmark(b *testing.B) Batch {
	b.Helper()
	raw, err := os.ReadFile("../../../core/observability/fixtures/generation-run.json")
	if err != nil {
		b.Fatal(err)
	}
	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		b.Fatal(err)
	}
	return batch
}

func benchmarkFixtureRunID(b *testing.B, batch Batch) string {
	b.Helper()
	if len(batch.Records) == 0 || batch.Records[0].RunID == "" {
		b.Fatal("generation fixture is missing its run id")
	}
	return batch.Records[0].RunID
}

func assertGoldenJSON(t *testing.T, path string, got any) {
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
