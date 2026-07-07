package workers

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const defaultTierALeafBudgetMs = 100

var benchmarkCopyExcludedNames = map[string]bool{
	".cache":       true,
	".crux":        true,
	".git":         true,
	".next":        true,
	".turbo":       true,
	"build":        true,
	"coverage":     true,
	"dist":         true,
	"node_modules": true,
	"target":       true,
}

var projectIndexStaticTimingBenchmarkNames = []string{
	planner.TimingConfig,
	planner.TimingFileSelection,
	planner.TimingFileWalk,
	planner.TimingFileClassify,
	planner.TimingSupportFiles,
	planner.TimingSelectionFinalize,
	planner.TimingSourceGraph,
	planner.TimingCacheStatus,
	planner.TimingExtensionManifest,
	planner.TimingExtensionFileSelection,
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

var projectIndexNodeReasonBenchmarkNames = []string{
	projectIndexNodeReasonStaticPlanInspection,
	projectIndexNodeReasonStaticIndexConfig,
	projectIndexNodeReasonStaticIndexExtensions,
	projectIndexNodeReasonStaticIndexEmpty,
	projectIndexNodeReasonStaticIndexEvidence,
	projectIndexNodeReasonStaticIndexRules,
	projectIndexNodeReasonStaticIndexIncomplete,
}

func BenchmarkWorkerIndexProjectAstPatch(b *testing.B) {
	root := os.Getenv("CRUX_INDEXER_BENCH_ROOT")
	if root == "" {
		b.Skip("set CRUX_INDEXER_BENCH_ROOT to benchmark Project Index AST")
	}
	if _, err := os.Stat(root); err != nil {
		b.Fatalf("stat CRUX_INDEXER_BENCH_ROOT: %v", err)
	}
	configPath := benchmarkStaticIndexConfig(b, root)
	clearCache := os.Getenv("CRUX_INDEXER_BENCH_CLEAR_CACHE") == "1"
	worker := newTestWorker(b)
	defer worker.Close()
	if worker.syntaxParser == nil {
		b.Skip("set CRUX_STATIC_INDEX_WORKER to benchmark production Go to Rust/Oxc AST path")
	}

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
			assertProductionStaticIndexPathRan(b, worker.LastAstTiming())
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
		b.ReportMetric(timing.TotalMs, "pipeline_total_ms/op")
		b.ReportMetric(boolMetric(timing.NodeStarted), "node_started/op")
		b.ReportMetric(boolMetric(timing.NativeOnlyEligible), "native_only_eligible/op")
		reportTimingReasonMetrics(b, timing)
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
	configPath := benchmarkStaticIndexConfig(b, root)
	clearCache := os.Getenv("CRUX_INDEXER_BENCH_CLEAR_CACHE") == "1"
	qualityRoot := b.TempDir()
	worker := newTestWorker(b)
	defer worker.Close()
	if worker.syntaxParser == nil {
		b.Skip("set CRUX_STATIC_INDEX_WORKER to benchmark production Go to Rust/Oxc graph path")
	}

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
			assertProductionStaticIndexPathRan(b, worker.LastAstTiming())
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
		b.ReportMetric(timing.TotalMs, "ast_pipeline_total_ms/op")
		b.ReportMetric(boolMetric(timing.NodeStarted), "node_started/op")
		b.ReportMetric(boolMetric(timing.NativeOnlyEligible), "native_only_eligible/op")
		reportTimingReasonMetrics(b, timing)
		reportStaticTimingMetrics(b, timing)
		reportPhaseTimingMetrics(b, worker.LastSemanticTimings(), projectIndexSemanticTimingBenchmarkNames)
	}
}

func BenchmarkWorkerProductionWatchLeafPath(b *testing.B) {
	sourceRoot := os.Getenv("CRUX_INDEXER_BENCH_ROOT")
	if sourceRoot == "" {
		b.Skip("set CRUX_INDEXER_BENCH_ROOT to benchmark production Project Index watch")
	}
	if _, err := os.Stat(sourceRoot); err != nil {
		b.Fatalf("stat CRUX_INDEXER_BENCH_ROOT: %v", err)
	}
	root := prepareBenchmarkWatchRoot(b, sourceRoot)
	configPath := writeStaticIndexNativeConfig(b, root)
	qualityRoot := b.TempDir()
	worker := newTestWorker(b)
	defer worker.Close()
	if worker.syntaxParser == nil {
		b.Skip("set CRUX_STATIC_INDEX_WORKER to benchmark production Go to Rust/Oxc watch path")
	}

	ctx := context.Background()
	state := store.NewStore()
	service := devtools.NewService(
		state,
		quality.NewService(state, quality.Dir(filepath.Join(qualityRoot, "warm"))),
	).WithProjectIndexer(worker)
	defer service.Shutdown()
	warmIndex, err := service.ReindexProjectWithOptions(ctx, root, configPath, "bench-watch", devtools.ProjectReindexOptions{
		Semantic: devtools.ProjectSemanticDisabled,
	})
	if err != nil {
		b.Fatalf("warm ReindexProjectWithOptions: %v", err)
	}
	assertProductionStaticIndexPathRan(b, worker.LastAstTiming())
	leafFile, ok := selectBenchmarkLeafFile(warmIndex)
	if !ok {
		b.Fatalf("warm index selected no leaf source file with definitions")
	}

	budgetMs := tierABenchmarkBudgetMs()
	durations := make([]float64, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		appendBenchmarkMutation(b, leafFile, i)
		started := time.Now()
		index, err := service.ReindexProjectIncrementalWithOptions(
			ctx,
			root,
			configPath,
			"bench-watch",
			[]string{leafFile},
			nil,
			devtools.ProjectReindexOptions{
				Semantic: devtools.ProjectSemanticDisabled,
				Watch: devtools.ProjectWatchRunOptions{
					RunID:           uint64(i + 1),
					DeltaBatchCount: 1,
				},
			},
		)
		durationMs := elapsedMs(started)
		durations = append(durations, durationMs)
		if err != nil {
			b.Fatalf("ReindexProjectIncrementalWithOptions: %v", err)
		}
		assertProductionStaticIndexPathRan(b, worker.LastAstTiming())
		if projectindex.IsEmptyIndex(index) {
			b.Fatalf("incremental watch returned empty index")
		}
		status, err := service.ProjectIndexWatchStatus(ctx)
		if err != nil {
			b.Fatalf("ProjectIndexWatchStatus: %v", err)
		}
		if status.LastRun == nil || status.LastRun.PlanKind != "source-file-reindex" || status.LastRun.FallbackUsed {
			b.Fatalf("watch status = %+v, want source-file-reindex without fallback", status.LastRun)
		}
		reportWatchPhaseMetrics(b, durationMs, status.LastRun.PhaseTimingsMs)
		b.ReportMetric(float64(status.LastRun.AffectedFileCount), "affected_files/op")
	}
	b.StopTimer()

	p95 := percentile(durations, 0.95)
	b.ReportMetric(p95, "tier_a_leaf_p95_ms")
	if os.Getenv("CRUX_INDEXER_BENCH_SKIP_TIER_A_GATE") != "1" && p95 > budgetMs {
		b.Fatalf("Tier-A production watch leaf p95 = %.1fms, budget %.1fms", p95, budgetMs)
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

func reportWatchPhaseMetrics(b *testing.B, totalMs float64, phaseTimings map[string]float64) {
	b.Helper()
	knownMs := 0.0
	for name, durationMs := range phaseTimings {
		knownMs += durationMs
		metricName := strings.NewReplacer(".", "_").Replace(name)
		b.ReportMetric(durationMs, "watch_"+metricName+"_ms/op")
	}
	residualMs := totalMs - knownMs
	if residualMs < 0 {
		residualMs = 0
	}
	b.ReportMetric(residualMs, "watch_post_ast_ms/op")
}

func benchmarkStaticIndexConfig(b *testing.B, root string) string {
	b.Helper()
	if configPath := os.Getenv("CRUX_INDEXER_BENCH_CONFIG"); configPath != "" {
		return configPath
	}
	return writeStaticIndexNativeConfig(b, root)
}

func prepareBenchmarkWatchRoot(b *testing.B, root string) string {
	b.Helper()
	if os.Getenv("CRUX_INDEXER_BENCH_IN_PLACE") == "1" {
		return root
	}
	destination := filepath.Join(b.TempDir(), "project")
	if err := copyBenchmarkRoot(root, destination); err != nil {
		b.Fatalf("copy benchmark root: %v", err)
	}
	return destination
}

func copyBenchmarkRoot(sourceRoot string, destinationRoot string) error {
	return filepath.WalkDir(sourceRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relativePath, err := filepath.Rel(sourceRoot, path)
		if err != nil {
			return err
		}
		if relativePath == "." {
			return os.MkdirAll(destinationRoot, 0o755)
		}
		if benchmarkPathExcluded(relativePath) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		destination := filepath.Join(destinationRoot, relativePath)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		return copyBenchmarkFile(path, destination, entry)
	})
}

func benchmarkPathExcluded(path string) bool {
	for _, part := range strings.Split(path, string(filepath.Separator)) {
		if benchmarkCopyExcludedNames[part] {
			return true
		}
	}
	return false
}

func copyBenchmarkFile(source string, destination string, entry fs.DirEntry) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := entry.Info()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func selectBenchmarkLeafFile(index store.IndexData) (string, bool) {
	for _, source := range index.Sources {
		if source.Status == "deleted" || len(source.DefinitionIDs) == 0 || len(source.Dependents) > 0 {
			continue
		}
		if source.File != "" && fileExists(source.File) {
			return source.File, true
		}
	}
	for _, source := range index.Sources {
		if source.Status == "deleted" || len(source.DefinitionIDs) == 0 {
			continue
		}
		if source.File != "" && fileExists(source.File) {
			return source.File, true
		}
	}
	return "", false
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func appendBenchmarkMutation(b *testing.B, file string, index int) {
	b.Helper()
	handle, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		b.Fatalf("open mutation target: %v", err)
	}
	defer handle.Close()
	if _, err := fmt.Fprintf(handle, "\n// crux production watch benchmark %d\n", index); err != nil {
		b.Fatalf("append mutation: %v", err)
	}
}

func assertProductionStaticIndexPathRan(b *testing.B, timing ProjectIndexAstTiming) {
	b.Helper()
	if !timing.UsedStaticIndex {
		b.Fatalf("benchmark did not use Static Index compiler path: %+v", timing)
	}
}

func tierABenchmarkBudgetMs() float64 {
	raw := os.Getenv("CRUX_INDEXER_BENCH_TIER_A_MS")
	if raw == "" {
		return defaultTierALeafBudgetMs
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil || parsed <= 0 {
		return defaultTierALeafBudgetMs
	}
	return parsed
}

func percentile(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	slices.Sort(sorted)
	index := int(math.Ceil(float64(len(sorted))*p)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func reportTimingReasonMetrics(b *testing.B, timing ProjectIndexAstTiming) {
	for _, reason := range projectIndexNodeReasonBenchmarkNames {
		metricName := strings.NewReplacer("-", "_").Replace(reason)
		b.ReportMetric(boolMetric(containsTimingReason(timing.NodeReasons, reason)), metricName+"_reason/op")
	}
}

func reportStaticTimingMetrics(b *testing.B, timing ProjectIndexAstTiming) {
	reportPhaseTimingMetrics(b, timing.NodeTimings, projectIndexStaticTimingBenchmarkNames)
}

func reportPhaseTimingMetrics(
	b *testing.B,
	timings []projectindex.ProjectIndexPhaseTiming,
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
