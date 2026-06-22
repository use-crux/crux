package server

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var projectIndexStaticTimingBenchmarkNames = []string{
	"static.semantic_profile",
	"static.cache.key",
	"static.cache.read",
	"static.cache.write",
	"static.syntax_records.total",
	"static.syntax_record.batch_parse",
	"static.syntax_record.parse_file",
	"static.syntax_record.provider_read",
	"static.syntax_record.provider_json_parse",
	"static.syntax_record.preload_imports",
	"static.syntax_record.extract_matches",
	"static.syntax_record.tree_paths",
	"static.syntax_record.imported_definitions",
	"static.extract_file.total",
}

func BenchmarkProjectIndexWorkerIndexProjectAstPatch(b *testing.B) {
	root := os.Getenv("CRUX_INDEXER_BENCH_ROOT")
	if root == "" {
		b.Skip("set CRUX_INDEXER_BENCH_ROOT to benchmark Project Index AST")
	}
	if _, err := os.Stat(root); err != nil {
		b.Fatalf("stat CRUX_INDEXER_BENCH_ROOT: %v", err)
	}
	clearCache := os.Getenv("CRUX_INDEXER_BENCH_CLEAR_CACHE") == "1"
	worker := NewProjectIndexWorker("")
	defer worker.Close()

	ctx := context.Background()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if clearCache {
			if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
				b.Fatalf("clear index cache: %v", err)
			}
		}
		var patch IndexPatchForBenchmark
		memory, err := measureProcessTreeMemoryDuring(func() error {
			result, err := worker.IndexProjectAstPatch(ctx, root, "", fmt.Sprintf("bench-%d", i))
			if err != nil {
				return err
			}
			patch = IndexPatchForBenchmark{
				definitions: len(result.Facts.Definitions),
				relations:   len(result.Facts.Relations),
			}
			return nil
		})
		if err != nil {
			b.Fatalf("IndexProjectAstPatch: %v", err)
		}
		timing := worker.LastAstTiming()
		b.ReportMetric(float64(patch.definitions), "definitions/op")
		b.ReportMetric(float64(patch.relations), "relations/op")
		b.ReportMetric(bytesToMiB(memory.startBytes), "tree_rss_start_mb/op")
		b.ReportMetric(bytesToMiB(memory.endBytes), "tree_rss_end_mb/op")
		b.ReportMetric(bytesToMiB(memory.peakBytes), "tree_rss_peak_mb/op")
		b.ReportMetric(timing.PlanMs, "plan_ms/op")
		b.ReportMetric(timing.NativeParseAndForwardMs, "native_parse_forward_ms/op")
		b.ReportMetric(timing.NodeProjectionMs, "node_projection_ms/op")
		b.ReportMetric(timing.TotalMs, "pipeline_total_ms/op")
		b.ReportMetric(float64(timing.RecordCount), "syntax_records/op")
		b.ReportMetric(float64(timing.RecordBytes), "syntax_record_bytes/op")
		b.ReportMetric(float64(timing.ChunkCount), "syntax_chunks/op")
		b.ReportMetric(float64(timing.MaxChunkBytes), "syntax_max_chunk_bytes/op")
		reportStaticTimingMetrics(b, timing)
	}
}

func reportStaticTimingMetrics(b *testing.B, timing ProjectIndexAstTiming) {
	timingsByName := make(map[string]float64, len(timing.NodeTimings))
	countsByName := make(map[string]int, len(timing.NodeTimings))
	for _, item := range timing.NodeTimings {
		timingsByName[item.Name] += item.DurationMs
		countsByName[item.Name] += item.Count
	}
	for _, name := range projectIndexStaticTimingBenchmarkNames {
		durationMs := timingsByName[name]
		if durationMs == 0 {
			continue
		}
		metricName := strings.NewReplacer(".", "_").Replace(name)
		b.ReportMetric(durationMs, metricName+"_ms/op")
		b.ReportMetric(float64(countsByName[name]), metricName+"_count/op")
	}
}

type IndexPatchForBenchmark struct {
	definitions int
	relations   int
}
