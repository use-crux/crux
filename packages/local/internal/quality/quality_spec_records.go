package quality

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

// Read models over the spec-02 Quality contracts (the rewritten engine's
// records under `.crux/quality/`). These back the canonical
// `/api/quality/{experiments,baselines,cassettes,overview,scorers}` endpoints;
// the pre-rewrite read models live on under `/api/quality/legacy/*` for the
// TUI until the devtools UI workstream retires them (see the designer
// handover: docs/handover-quality-devtools-contract.md in the Karyla repo).

// ExperimentSummariesAPI lists all spec-02 experiment records as
// presentation rows, newest first.
func (s *Service) ExperimentSummariesAPI(_ context.Context) ([]api.QualityExperimentSummary, error) {
	records, _, err := qualityfs.Open(s.dir).ReadExperimentRecords()
	if err != nil {
		return nil, err
	}
	summaries := make([]api.QualityExperimentSummary, 0, len(records))
	for _, file := range records {
		summaries = append(summaries, experimentSummary(file.Record))
	}
	return summaries, nil
}

func experimentSummary(record qualityfs.ExperimentRecord) api.QualityExperimentSummary {
	summary := api.QualityExperimentSummary{
		ExperimentID:       record.ExperimentID,
		EvaluationID:       record.EvaluationID,
		QualityID:          record.QualityID,
		ExperimentLabel:    record.ExperimentLabel,
		StartedAt:          record.StartedAt,
		EndedAt:            record.EndedAt,
		FilteredRun:        record.FilteredRun,
		ReplayMode:         record.Replay.Mode,
		Cassette:           record.Replay.Cassette,
		Variants:           make([]string, 0, len(record.Variants)),
		GatesPassed:        record.Gates.Passed,
		GatesInformational: record.Gates.Informational,
		HasComparison:      record.Comparison != nil,
		Passed:             record.Passed,
	}
	if record.BaselineRef != nil {
		summary.BaselineID = record.BaselineRef.BaselineID
	}
	for _, variant := range record.Variants {
		summary.Variants = append(summary.Variants, variant.Name)
	}
	for _, aggregate := range record.Aggregates.PerVariant {
		summary.Cells += aggregate.Cells
		summary.CellsPassed += aggregate.Passed
		summary.CellsFailed += aggregate.Failed
		summary.CellsErrored += aggregate.Errored
		summary.CellsSkipped += aggregate.Skipped
	}
	for _, gate := range record.Gates.Results {
		if !gate.Passed {
			summary.GateFailures++
		}
	}
	if record.Comparison != nil && record.Comparison.Demoted != nil {
		summary.ComparisonDemoted = true
	}
	return summary
}

// ExperimentRecordAPI returns one spec-02 experiment record VERBATIM — the
// stored bytes, never a struct round-trip (the schema evolves additively).
func (s *Service) ExperimentRecordAPI(_ context.Context, experimentID string) (json.RawMessage, bool, error) {
	return qualityfs.Open(s.dir).ReadExperimentRecordRaw(experimentID)
}

// BaselineRecordsAPI lists all committed spec-02 baseline records verbatim,
// newest promotion first.
func (s *Service) BaselineRecordsAPI(_ context.Context) ([]json.RawMessage, error) {
	records, _, err := qualityfs.Open(s.dir).ReadBaselineRecords()
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, 0, len(records))
	for _, file := range records {
		out = append(out, file.Raw)
	}
	return out, nil
}

// BaselineRecordAPI returns the committed baseline for one evaluation id,
// verbatim (spec-02 filename rule: `baselines/<evaluationId>.json`).
func (s *Service) BaselineRecordAPI(_ context.Context, evaluationID string) (json.RawMessage, bool, error) {
	return qualityfs.Open(s.dir).ReadBaselineRecordRaw(evaluationID)
}

// CassetteFilesAPI lists the engine's executor-boundary cassettes with the
// 90-day staleness flag the replay layer applies.
func (s *Service) CassetteFilesAPI(_ context.Context) ([]api.QualityCassetteFileRecord, error) {
	infos, err := qualityfs.Open(s.dir).ReadCassetteFiles(time.Now())
	if err != nil {
		return nil, err
	}
	records := make([]api.QualityCassetteFileRecord, 0, len(infos))
	for _, info := range infos {
		records = append(records, api.QualityCassetteFileRecord{
			Name:       info.Name,
			Path:       info.Path,
			RecordedAt: info.RecordedAt,
			SdkVersion: info.SdkVersion,
			Models:     info.Models,
			EntryCount: info.EntryCount,
			Stale:      info.Stale,
			SizeBytes:  info.SizeBytes,
		})
	}
	return records, nil
}

// OverviewRecordAPI is the workbench dashboard projection: counts and
// pass-rate series from the spec-02 records, KPIs/sparks from observability
// runs, and insight tallies from the derivation over both.
func (s *Service) OverviewRecordAPI(ctx context.Context) (api.QualityOverviewRecord, error) {
	fs := qualityfs.Open(s.dir)
	experiments, _, err := fs.ReadExperimentRecords()
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	baselines, _, err := fs.ReadBaselineRecords()
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	cassettes, err := fs.ReadCassetteFiles(time.Now())
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}

	var runs []qualityRunRecord
	if s.obs != nil {
		runs, err = buildQualityRunsFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store))
		if err != nil {
			return api.QualityOverviewRecord{}, err
		}
	}
	insights, err := buildQualityInsightsFromRuns(s.dir, runs)
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	feedback, err := s.Feedback(ctx)
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}

	feedbackNeedingReview := 0
	for _, item := range feedback {
		if item.Status == "" || item.Status == "new" {
			feedbackNeedingReview++
		}
	}
	openInsightSeverityCounts := map[string]int{}
	for _, insight := range insights {
		if insight.Status == "" || insight.Status == "open" {
			openInsightSeverityCounts[insight.Severity]++
		}
	}

	overview := api.QualityOverviewRecord{
		Tag:                        "QualityOverview",
		RunCount:                   len(runs),
		ExperimentCount:            len(experiments),
		BaselineCount:              len(baselines),
		CassetteCount:              len(cassettes),
		FeedbackCount:              len(feedback),
		FeedbackNeedingReviewCount: feedbackNeedingReview,
		InsightCount:               len(insights),
		TotalCost:                  qualityTotalCost(runs),
		PassRateHistory:            specPassRateHistory(experiments, time.Now()),
		OpenInsightsHistory:        qualityOpenInsightsHistory(insights),
		PassRateSpark:              qualityHourlyPassRateSpark(runs),
		CostSpark:                  qualityHourlyCostSpark(runs),
		LatencySpark:               qualityHourlyLatencySpark(runs),
		OpenInsightSeverityCounts:  openInsightSeverityCounts,
		RunTabCounts:               toRunTabCountsAPI(qualityRunTabCountsFromRuns(runs)),
		RecentRuns:                 toRecentRunsAPI(qualityRecentRuns(runs, 6)),
	}
	for _, cassette := range cassettes {
		if cassette.Stale {
			overview.StaleCassetteCount++
		}
	}
	if len(runs) > 0 {
		cost := (overview.TotalCost / float64(len(runs))) * 100
		overview.CostPer100Runs = &cost
	}
	if passRate := specPassRate(experiments); passRate != nil {
		overview.PassRate = passRate
	}
	if meanScore := qualityMeanRunScore(runs); meanScore != nil {
		overview.MeanScore = meanScore
	}
	if p50 := qualityP50Latency(runs); p50 != nil {
		overview.P50LatencyMs = p50
	}
	if p95 := qualityP95Latency(runs); p95 != nil {
		overview.P95LatencyMs = p95
	}
	if len(experiments) > 0 {
		latest := experiments[0].Record // newest-first by ULID
		overview.LatestExperimentID = latest.ExperimentID
		passed, total := specCellTally(latest)
		if total > 0 {
			rate := float64(passed) / float64(total)
			overview.LatestExperimentPassRate = &rate
		}
		overview.LatestExperimentCompletedAt = latest.EndedAt
		if overview.LatestExperimentCompletedAt == "" {
			overview.LatestExperimentCompletedAt = latest.StartedAt
		}
	}
	return overview, nil
}

func toRunTabCountsAPI(counts qualityRunTabCounts) api.QualityRunTabCounts {
	return api.QualityRunTabCounts{
		All:         counts.All,
		Live:        counts.Live,
		Failures:    counts.Failures,
		HasFeedback: counts.HasFeedback,
	}
}

func toRecentRunsAPI(runs []qualityRunRecord) []api.QualityRunRecord {
	if len(runs) == 0 {
		return nil
	}
	out, err := toAPI[[]api.QualityRunRecord](runs, nil)
	if err != nil {
		return nil
	}
	return out
}

// specCellTally counts (passed, total-non-skipped) cells across all variants
// of one spec-02 experiment record.
func specCellTally(record qualityfs.ExperimentRecord) (int, int) {
	passed := 0
	total := 0
	for _, aggregate := range record.Aggregates.PerVariant {
		passed += aggregate.Passed
		total += aggregate.Cells - aggregate.Skipped
	}
	return passed, total
}

// specPassRate is the cell-level pass rate across all spec-02 experiments.
func specPassRate(records []qualityfs.ExperimentRecordFile) *float64 {
	passed := 0
	total := 0
	for _, file := range records {
		filePassed, fileTotal := specCellTally(file.Record)
		passed += filePassed
		total += fileTotal
	}
	if total == 0 {
		return nil
	}
	rate := float64(passed) / float64(total)
	return &rate
}

// specPassRateHistory buckets experiment pass rates into 14 daily buckets,
// carrying the last known rate forward through empty buckets (the same
// rendering contract the dashboard sparkline always had).
func specPassRateHistory(records []qualityfs.ExperimentRecordFile, now time.Time) []float64 {
	const buckets = 14
	step := 24 * time.Hour
	out := make([]float64, buckets)
	now = now.UTC().Truncate(step)
	last := 0.0
	for i := 0; i < buckets; i++ {
		start := now.Add(time.Duration(i-buckets+1) * step)
		end := start.Add(step)
		passed := 0
		total := 0
		for _, file := range records {
			record := file.Record
			endedAt := record.EndedAt
			if endedAt == "" {
				endedAt = record.StartedAt
			}
			at, ok := parseQualityTime(endedAt)
			if !ok || at.Before(start) || !at.Before(end) {
				continue
			}
			filePassed, fileTotal := specCellTally(record)
			passed += filePassed
			total += fileTotal
		}
		if total > 0 {
			last = float64(passed) / float64(total)
		}
		out[i] = last
	}
	return out
}

// ExperimentDetailAPI parses one spec-02 experiment record into the typed
// mirror for native (TUI) rendering. HTTP serves the bytes verbatim instead.
func (s *Service) ExperimentDetailAPI(_ context.Context, experimentID string) (api.QualityExperimentDetail, bool, error) {
	raw, found, err := qualityfs.Open(s.dir).ReadExperimentRecordRaw(experimentID)
	if err != nil || !found {
		return api.QualityExperimentDetail{}, found, err
	}
	var detail api.QualityExperimentDetail
	if err := json.Unmarshal(raw, &detail); err != nil {
		return api.QualityExperimentDetail{}, false, err
	}
	return detail, true, nil
}

// PromotedBaselinesAPI lists committed spec-02 baselines as typed mirrors
// for native rendering.
func (s *Service) PromotedBaselinesAPI(_ context.Context) ([]api.QualityPromotedBaseline, error) {
	records, _, err := qualityfs.Open(s.dir).ReadBaselineRecords()
	if err != nil {
		return nil, err
	}
	out := make([]api.QualityPromotedBaseline, 0, len(records))
	for _, file := range records {
		var baseline api.QualityPromotedBaseline
		if err := json.Unmarshal(file.Raw, &baseline); err != nil {
			continue
		}
		out = append(out, baseline)
	}
	return out, nil
}

const (
	evaluationProgressDefaultLimit = 20
	evaluationProgressMaxLimit     = 100
)

// EvaluationProgressAPI builds the server-owned progress read model for one
// evaluation from recent spec-02 experiment records and the current baseline.
func (s *Service) EvaluationProgressAPI(_ context.Context, evaluationID string, limit int) (api.QualityEvaluationProgress, bool, error) {
	fs := qualityfs.Open(s.dir)
	records, _, err := fs.ReadExperimentRecords()
	if err != nil {
		return api.QualityEvaluationProgress{}, false, err
	}
	matching := make([]qualityfs.ExperimentRecord, 0, len(records))
	for _, file := range records {
		if file.Record.EvaluationID == evaluationID {
			matching = append(matching, file.Record)
		}
	}
	if len(matching) == 0 {
		return api.QualityEvaluationProgress{}, false, nil
	}
	sort.SliceStable(matching, func(i, j int) bool {
		left := qualityExperimentProgressSortKey(matching[i])
		right := qualityExperimentProgressSortKey(matching[j])
		if left == right {
			return matching[i].ExperimentID > matching[j].ExperimentID
		}
		return left > right
	})

	effectiveLimit := normalizeEvaluationProgressLimit(limit)
	if len(matching) > effectiveLimit {
		matching = matching[:effectiveLimit]
	}

	baselineScores, baselineID, err := evaluationProgressBaselineScores(fs, evaluationID)
	if err != nil {
		return api.QualityEvaluationProgress{}, false, err
	}
	progress := api.QualityEvaluationProgress{
		Tag:           "QualityEvaluationProgress",
		SchemaVersion: 1,
		EvaluationID:  evaluationID,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Limit:         effectiveLimit,
		Runs:          make([]api.QualityEvaluationProgressRun, 0, len(matching)),
	}

	pointsByScore := map[string][]api.QualityScoreProgressPoint{}
	for _, record := range matching {
		progress.Runs = append(progress.Runs, evaluationProgressRun(record))
		for scoreName, stats := range evaluationProgressScoreStats(record) {
			point := api.QualityScoreProgressPoint{
				ExperimentID: record.ExperimentID,
				Mean:         stats.Mean,
				SEM:          stats.SEM,
				N:            stats.N,
			}
			if passed, ok := evaluationProgressScoreGate(record, scoreName); ok {
				point.PassedGate = &passed
			}
			pointsByScore[scoreName] = append(pointsByScore[scoreName], point)
		}
	}

	scoreNames := make([]string, 0, len(pointsByScore))
	for scoreName := range pointsByScore {
		scoreNames = append(scoreNames, scoreName)
	}
	sort.Strings(scoreNames)
	progress.ScoreSeries = make([]api.QualityScoreProgressSeries, 0, len(scoreNames))
	for _, scoreName := range scoreNames {
		series := api.QualityScoreProgressSeries{
			ScoreName: scoreName,
			Points:    pointsByScore[scoreName],
		}
		if baselineID != "" {
			if value, ok := baselineScores[scoreName]; ok {
				series.Baseline = &api.QualityScoreProgressBaseline{
					Value:      value,
					BaselineID: baselineID,
				}
			}
		}
		progress.ScoreSeries = append(progress.ScoreSeries, series)
	}
	return progress, true, nil
}

func normalizeEvaluationProgressLimit(limit int) int {
	if limit <= 0 {
		return evaluationProgressDefaultLimit
	}
	if limit > evaluationProgressMaxLimit {
		return evaluationProgressMaxLimit
	}
	return limit
}

func qualityExperimentProgressSortKey(record qualityfs.ExperimentRecord) string {
	return nonEmptyString(record.EndedAt, record.StartedAt, record.ExperimentID)
}

func evaluationProgressRun(record qualityfs.ExperimentRecord) api.QualityEvaluationProgressRun {
	passed, total := specCellTally(record)
	return api.QualityEvaluationProgressRun{
		ExperimentID: record.ExperimentID,
		StartedAt:    record.StartedAt,
		FinishedAt:   record.EndedAt,
		Verdict:      evaluationProgressVerdict(record, total),
		PassRate:     passRateFromSummary(passed, total),
		DurationMs:   evaluationProgressDurationMs(record),
		CostUsd:      evaluationProgressCostUsd(record),
	}
}

func evaluationProgressVerdict(record qualityfs.ExperimentRecord, total int) string {
	if record.Passed {
		return "passed"
	}
	errored := 0
	skipped := 0
	cells := 0
	for _, aggregate := range record.Aggregates.PerVariant {
		errored += aggregate.Errored
		skipped += aggregate.Skipped
		cells += aggregate.Cells
	}
	if errored > 0 {
		return "errored"
	}
	if cells > 0 && total == 0 && skipped == cells {
		return "skipped"
	}
	return "failed"
}

func evaluationProgressDurationMs(record qualityfs.ExperimentRecord) *float64 {
	started, ok := parseQualityTime(record.StartedAt)
	if !ok || record.EndedAt == "" {
		return nil
	}
	ended, ok := parseQualityTime(record.EndedAt)
	if !ok {
		return nil
	}
	duration := float64(ended.Sub(started).Milliseconds())
	if duration < 0 {
		return nil
	}
	return &duration
}

func evaluationProgressCostUsd(record qualityfs.ExperimentRecord) *float64 {
	total := 0.0
	found := false
	for _, aggregate := range record.Aggregates.PerVariant {
		if aggregate.CostUsd == nil {
			continue
		}
		total += *aggregate.CostUsd
		found = true
	}
	if !found {
		return nil
	}
	return &total
}

func evaluationProgressScoreStats(record qualityfs.ExperimentRecord) map[string]qualityfs.SpecScoreStats {
	type scoreAccumulator struct {
		weightedMean float64
		weightedSEM  float64
		n            int
	}
	byName := map[string]scoreAccumulator{}
	for _, aggregate := range record.Aggregates.PerVariant {
		for scoreName, stats := range aggregate.Scores {
			if scoreName == "" || stats.N <= 0 {
				continue
			}
			current := byName[scoreName]
			current.weightedMean += stats.Mean * float64(stats.N)
			current.weightedSEM += stats.SEM * float64(stats.N)
			current.n += stats.N
			byName[scoreName] = current
		}
	}
	out := make(map[string]qualityfs.SpecScoreStats, len(byName))
	for scoreName, current := range byName {
		if current.n == 0 {
			continue
		}
		out[scoreName] = qualityfs.SpecScoreStats{
			Mean: math.Round(current.weightedMean/float64(current.n)*1e6) / 1e6,
			SEM:  math.Round(current.weightedSEM/float64(current.n)*1e6) / 1e6,
			N:    current.n,
		}
	}
	return out
}

func evaluationProgressScoreGate(record qualityfs.ExperimentRecord, scoreName string) (bool, bool) {
	for _, gate := range record.Gates.Results {
		if gate.Gate == "" || !strings.Contains(gate.Gate, scoreName) {
			continue
		}
		return gate.Passed, true
	}
	return false, false
}

func evaluationProgressBaselineScores(fs *qualityfs.FS, evaluationID string) (map[string]float64, string, error) {
	baselines, _, err := fs.ReadBaselineRecords()
	if err != nil {
		return nil, "", err
	}
	for _, file := range baselines {
		record := file.Record
		if record.EvaluationID != evaluationID {
			continue
		}
		return meanBaselineScores(record.Reference), record.BaselineID, nil
	}
	return map[string]float64{}, "", nil
}

func meanBaselineScores(reference map[string]map[string]float64) map[string]float64 {
	type scoreAccumulator struct {
		sum float64
		n   int
	}
	accumulators := map[string]scoreAccumulator{}
	for _, scores := range reference {
		for scoreName, value := range scores {
			if scoreName == "" {
				continue
			}
			current := accumulators[scoreName]
			current.sum += value
			current.n++
			accumulators[scoreName] = current
		}
	}
	out := make(map[string]float64, len(accumulators))
	for scoreName, current := range accumulators {
		if current.n == 0 {
			continue
		}
		out[scoreName] = math.Round(current.sum/float64(current.n)*1e6) / 1e6
	}
	return out
}

// ScorerStatsAPI aggregates scorer usage across all spec-02 experiment
// records: evaluations using each scorer, scored cell count, and the mean
// over non-null scores.
func (s *Service) ScorerStatsAPI(_ context.Context) ([]api.QualityScorerStats, error) {
	records, _, err := qualityfs.Open(s.dir).ReadExperimentRecords()
	if err != nil {
		return nil, err
	}
	type aggregate struct {
		costClass   string
		evaluations map[string]struct{}
		cellCount   int
		scoreSum    float64
		scoreCount  int
		lastUsedAt  string
	}
	byName := map[string]*aggregate{}
	for _, file := range records {
		record := file.Record
		usedAt := record.EndedAt
		if usedAt == "" {
			usedAt = record.StartedAt
		}
		for _, cell := range record.Cases {
			for _, score := range cell.Scores {
				if score.Name == "" {
					continue
				}
				current, ok := byName[score.Name]
				if !ok {
					current = &aggregate{evaluations: map[string]struct{}{}}
					byName[score.Name] = current
				}
				if score.CostClass != "" {
					current.costClass = score.CostClass
				}
				current.evaluations[record.EvaluationID] = struct{}{}
				current.cellCount++
				if score.Score != nil {
					current.scoreSum += *score.Score
					current.scoreCount++
				}
				if usedAt > current.lastUsedAt {
					current.lastUsedAt = usedAt
				}
			}
		}
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	stats := make([]api.QualityScorerStats, 0, len(names))
	for _, name := range names {
		current := byName[name]
		evaluationIDs := make([]string, 0, len(current.evaluations))
		for id := range current.evaluations {
			evaluationIDs = append(evaluationIDs, id)
		}
		sort.Strings(evaluationIDs)
		entry := api.QualityScorerStats{
			Name:          name,
			CostClass:     current.costClass,
			EvaluationIDs: evaluationIDs,
			CellCount:     current.cellCount,
			LastUsedAt:    current.lastUsedAt,
		}
		if current.scoreCount > 0 {
			mean := math.Round(current.scoreSum/float64(current.scoreCount)*1e6) / 1e6
			entry.MeanScore = &mean
		}
		stats = append(stats, entry)
	}
	return stats, nil
}
