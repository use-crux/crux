package projectindexer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticplan"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

var projectIndexStaticTimingBenchmarkNames = []string{
	staticplan.TimingConfig,
	staticplan.TimingFileSelection,
	staticplan.TimingFileWalk,
	staticplan.TimingFileClassify,
	staticplan.TimingSupportFiles,
	staticplan.TimingSelectionFinalize,
	staticplan.TimingSourceGraph,
	staticplan.TimingCacheStatus,
	staticplan.TimingExtensionManifest,
	staticplan.TimingExtensionFileSelection,
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

var projectIndexSemanticTimingBenchmarkNames = []string{
	"semantic.selection",
	"semantic.preflight",
	"semantic.cache.disabled",
	"semantic.cache.hit",
	"semantic.cache.miss",
	"semantic.cache.read",
	"semantic.cache.unkeyed",
	"semantic.cache.write",
	"semantic.program.create",
	"semantic.program.reuse",
	"semantic.checker.create",
	"semantic.analyzer.execution",
	"semantic.merge",
	"semantic.native.host.create",
	"semantic.native.host.reuse",
	"semantic.native.extractor.direct_crux",
	"semantic.native.analyzer.shared",
}

func BenchmarkWorkerIndexProjectAstPatch(b *testing.B) {
	root := os.Getenv("CRUX_INDEXER_BENCH_ROOT")
	if root == "" {
		b.Skip("set CRUX_INDEXER_BENCH_ROOT to benchmark Project Index AST")
	}
	if _, err := os.Stat(root); err != nil {
		b.Fatalf("stat CRUX_INDEXER_BENCH_ROOT: %v", err)
	}
	configPath := os.Getenv("CRUX_INDEXER_BENCH_CONFIG")
	assertNativePath := os.Getenv("CRUX_INDEXER_BENCH_NATIVE_AST") == "1"
	if assertNativePath {
		configPath = writeNativeStaticParityConfig(b, root)
	}
	clearCache := os.Getenv("CRUX_INDEXER_BENCH_CLEAR_CACHE") == "1"
	worker := newTestWorker(b)
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
			result, err := worker.IndexProjectAstPatch(ctx, root, configPath, fmt.Sprintf("bench-%d", i))
			if err != nil {
				return err
			}
			if assertNativePath {
				assertNativeSyntaxPathRan(b, worker.LastAstTiming())
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
		b.ReportMetric(boolMetric(timing.NodeStarted), "node_started/op")
		b.ReportMetric(boolMetric(timing.NativeOnlyEligible), "native_only_eligible/op")
		reportTimingReasonMetrics(b, timing)
		b.ReportMetric(float64(timing.RecordCount), "syntax_records/op")
		b.ReportMetric(float64(timing.RecordBytes), "syntax_record_bytes/op")
		b.ReportMetric(float64(timing.ChunkCount), "syntax_chunks/op")
		b.ReportMetric(float64(timing.MaxChunkBytes), "syntax_max_chunk_bytes/op")
		reportStaticTimingMetrics(b, timing)
	}
}

func BenchmarkWorkerReindexProjectGraphPipeline(b *testing.B) {
	root := os.Getenv("CRUX_INDEXER_BENCH_ROOT")
	if root == "" {
		b.Skip("set CRUX_INDEXER_BENCH_ROOT to benchmark Project Index graph pipeline")
	}
	if _, err := os.Stat(root); err != nil {
		b.Fatalf("stat CRUX_INDEXER_BENCH_ROOT: %v", err)
	}
	configPath := os.Getenv("CRUX_INDEXER_BENCH_CONFIG")
	assertNativePath := os.Getenv("CRUX_INDEXER_BENCH_NATIVE_AST") == "1"
	if assertNativePath {
		configPath = writeNativeStaticParityConfig(b, root)
	}
	clearCache := os.Getenv("CRUX_INDEXER_BENCH_CLEAR_CACHE") == "1"
	qualityRoot := b.TempDir()
	worker := newTestWorker(b)
	defer worker.Close()

	ctx := context.Background()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if clearCache {
			if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
				b.Fatalf("clear index cache: %v", err)
			}
		}
		var index store.IndexData
		memory, err := measureProcessTreeMemoryDuring(func() error {
			state := store.NewStore()
			service := devtools.NewService(
				state,
				quality.NewService(state, quality.Dir(filepath.Join(qualityRoot, fmt.Sprintf("run-%d", i)))),
			).WithProjectIndexer(worker)
			defer service.Shutdown()
			result, err := service.ReindexProjectWithOptions(ctx, root, configPath, fmt.Sprintf("bench-%d", i), devtools.ProjectReindexOptions{
				Semantic: devtools.ProjectSemanticInline,
			})
			if err != nil {
				return err
			}
			if assertNativePath {
				assertNativeSyntaxPathRan(b, worker.LastAstTiming())
			}
			index = result
			return nil
		})
		if err != nil {
			b.Fatalf("ReindexProjectWithOptions: %v", err)
		}
		timing := worker.LastAstTiming()
		b.ReportMetric(float64(len(index.Definitions)), "definitions/op")
		b.ReportMetric(float64(len(index.Relations)), "relations/op")
		b.ReportMetric(float64(len(index.Sources)), "sources/op")
		b.ReportMetric(float64(len(index.Diagnostics)), "diagnostics/op")
		b.ReportMetric(float64(len(index.LintFindings)), "lint_findings/op")
		b.ReportMetric(float64(len(index.RuleDescriptors)), "rule_descriptors/op")
		reportIndexingStatusMetrics(b, index.Indexing)
		b.ReportMetric(bytesToMiB(memory.startBytes), "tree_rss_start_mb/op")
		b.ReportMetric(bytesToMiB(memory.endBytes), "tree_rss_end_mb/op")
		b.ReportMetric(bytesToMiB(memory.peakBytes), "tree_rss_peak_mb/op")
		b.ReportMetric(timing.PlanMs, "plan_ms/op")
		b.ReportMetric(timing.NativeParseAndForwardMs, "native_parse_forward_ms/op")
		b.ReportMetric(timing.NodeProjectionMs, "node_projection_ms/op")
		b.ReportMetric(timing.TotalMs, "ast_pipeline_total_ms/op")
		b.ReportMetric(boolMetric(timing.NodeStarted), "node_started/op")
		b.ReportMetric(boolMetric(timing.NativeOnlyEligible), "native_only_eligible/op")
		reportTimingReasonMetrics(b, timing)
		reportStaticTimingMetrics(b, timing)
		reportPhaseTimingMetrics(b, worker.LastSemanticTimings(), projectIndexSemanticTimingBenchmarkNames)
	}
}

func reportIndexingStatusMetrics(b *testing.B, indexing *store.ProjectIndexingStatus) {
	if indexing == nil {
		return
	}
	b.ReportMetric(float64(indexing.AST.DurationMs), "ast_status_ms/op")
	b.ReportMetric(float64(indexing.AST.FileCount), "ast_status_files/op")
	b.ReportMetric(float64(indexing.Semantic.DurationMs), "semantic_status_ms/op")
	b.ReportMetric(float64(indexing.Semantic.EnrichedDefinitionCount), "semantic_enriched_definitions/op")
}

func reportTimingReasonMetrics(b *testing.B, timing ProjectIndexAstTiming) {
	for _, reason := range []string{
		projectIndexNodeReasonTypeScriptStaticCompiler,
		projectIndexNodeReasonStaticPlanInspection,
		projectIndexNodeReasonSyntaxRecordProjection,
		projectIndexNodeReasonNativeStaticEmpty,
		projectIndexNodeReasonNativeStaticEvidence,
		projectIndexNodeReasonNativeStaticIncomplete,
	} {
		metricName := strings.NewReplacer("-", "_").Replace(reason)
		b.ReportMetric(boolMetric(containsTimingReason(timing.NodeReasons, reason)), metricName+"_reason/op")
	}
}

func reportStaticTimingMetrics(b *testing.B, timing ProjectIndexAstTiming) {
	reportPhaseTimingMetrics(b, timing.NodeTimings, projectIndexStaticTimingBenchmarkNames)
}

func reportPhaseTimingMetrics(
	b *testing.B,
	timings []devtools.ProjectIndexPhaseTiming,
	names []string,
) {
	timingsByName := make(map[string]float64, len(timings))
	countsByName := make(map[string]int, len(timings))
	for _, item := range timings {
		timingsByName[item.Name] += item.DurationMs
		countsByName[item.Name] += item.Count
	}
	for _, name := range names {
		durationMs := timingsByName[name]
		count := countsByName[name]
		if durationMs == 0 && count == 0 {
			continue
		}
		metricName := strings.NewReplacer(".", "_").Replace(name)
		if durationMs != 0 {
			b.ReportMetric(durationMs, metricName+"_ms/op")
		}
		if count != 0 {
			b.ReportMetric(float64(count), metricName+"_count/op")
		}
	}
}

func boolMetric(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

type IndexPatchForBenchmark struct {
	definitions int
	relations   int
}
