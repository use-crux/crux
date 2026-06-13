package quality

import (
	"context"
	"encoding/json"
	"math"
	"sort"
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
