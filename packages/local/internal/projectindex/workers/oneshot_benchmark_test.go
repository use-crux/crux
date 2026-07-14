package workers

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
)

// BenchmarkOneShotProjectIndexBaselines records non-gating cold/warm latency
// and peak process-tree RSS for representative project roots. Supply one or
// more CRUX_INDEXER_BENCH_ROOT_{SMALL,MEDIUM,LARGE} values; roots are copied to
// temporary directories so cold-cache measurement never deletes user state.
// The Tier-A leaf budget is reported only as context, not enforced here.
func BenchmarkOneShotProjectIndexBaselines(b *testing.B) {
	fixtures := []struct {
		name string
		env  string
	}{
		{name: "small", env: "CRUX_INDEXER_BENCH_ROOT_SMALL"},
		{name: "medium", env: "CRUX_INDEXER_BENCH_ROOT_MEDIUM"},
		{name: "large", env: "CRUX_INDEXER_BENCH_ROOT_LARGE"},
	}
	configured := false
	for _, fixture := range fixtures {
		sourceRoot := os.Getenv(fixture.env)
		if sourceRoot == "" {
			continue
		}
		configured = true
		b.Run(fixture.name, func(b *testing.B) {
			root := prepareBenchmarkWatchRoot(b, sourceRoot)
			configPath := benchmarkStaticIndexConfig(b, root)
			worker := newTestWorker(b)
			defer worker.Close()
			if worker.syntaxParser == nil {
				b.Skip("set CRUX_STATIC_INDEX_WORKER to record one-shot baselines")
			}
			runner := oneshot.New(worker, nil)
			var coldMs float64
			var warmTotalMs float64
			var warmRuns int
			var peakBytes uint64
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				started := time.Now()
				memory, err := measureProcessTreeMemoryDuring(func() error {
					_, err := runner.Run(context.Background(), oneshot.Options{
						Root: root, ConfigPath: configPath, ProjectID: "benchmark-" + fixture.name,
					})
					return err
				})
				if err != nil {
					b.Fatal(err)
				}
				elapsed := float64(time.Since(started).Microseconds()) / 1000
				if i == 0 {
					coldMs = elapsed
				} else {
					warmTotalMs += elapsed
					warmRuns++
				}
				if memory.peakBytes > peakBytes {
					peakBytes = memory.peakBytes
				}
			}
			b.StopTimer()
			b.ReportMetric(coldMs, "cold_ms")
			if warmRuns > 0 {
				b.ReportMetric(warmTotalMs/float64(warmRuns), "warm_ms")
			}
			b.ReportMetric(bytesToMiB(peakBytes), "tree_rss_peak_mb")
			b.ReportMetric(tierABenchmarkBudgetMs(), "tier_a_leaf_budget_ms")
		})
	}
	if !configured {
		b.Skip("set CRUX_INDEXER_BENCH_ROOT_SMALL, _MEDIUM, or _LARGE")
	}
}
