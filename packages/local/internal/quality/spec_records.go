package quality

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strconv"
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

const (
	qualityExperimentsDefaultLimit = 150
	qualityExperimentsMaxLimit     = 500
)

// ExperimentSummariesAPI lists all spec-02 experiment records as
// presentation rows, newest first. Native clients still use this flat list;
// the HTTP /api/quality/experiments route uses ExperimentsPageAPI below.
func (s *Service) ExperimentSummariesAPI(_ context.Context) ([]api.QualityExperimentSummary, error) {
	summaries, _, err := s.allExperimentSummaries(time.Now())
	return summaries, err
}

// ExperimentsPageAPI lists experiment summaries with server-side filtering,
// facets, and pagination for the devtools experiments feed.
func (s *Service) ExperimentsPageAPI(_ context.Context, opts api.QualityExperimentsOptions) (api.QualityExperimentsPage, error) {
	now := time.Now().UTC()
	opts = normalizeQualityExperimentsOptions(opts)
	summaries, skippedRecords, err := s.allExperimentSummaries(now)
	if err != nil {
		return api.QualityExperimentsPage{}, err
	}
	window := newQualityOverviewWindow(opts.Window, now)

	windowRows := make([]api.QualityExperimentSummary, 0, len(summaries))
	evaluationSet := map[string]struct{}{}
	for _, summary := range summaries {
		if !qualityExperimentSummaryInWindow(summary, window) {
			continue
		}
		windowRows = append(windowRows, summary)
		if summary.EvaluationID != "" {
			evaluationSet[summary.EvaluationID] = struct{}{}
		}
	}

	evaluations := make([]string, 0, len(evaluationSet))
	for evaluationID := range evaluationSet {
		evaluations = append(evaluations, evaluationID)
	}
	sort.Strings(evaluations)

	facetRows := make([]api.QualityExperimentSummary, 0, len(windowRows))
	for _, summary := range windowRows {
		if opts.Evaluation != "" && summary.EvaluationID != opts.Evaluation {
			continue
		}
		facetRows = append(facetRows, summary)
	}
	statusCounts := qualityExperimentStatusCounts(facetRows)

	matching := make([]api.QualityExperimentSummary, 0, len(facetRows))
	for _, summary := range facetRows {
		if opts.Status != "" && summary.Status != opts.Status {
			continue
		}
		matching = append(matching, summary)
	}

	total := len(matching)
	start := opts.Offset
	if start > total {
		start = total
	}
	end := start + opts.Limit
	if end > total {
		end = total
	}
	pageRows := matching[start:end]

	page := api.QualityExperimentsPage{
		Tag:            "QualityExperimentsPage",
		Experiments:    pageRows,
		Total:          total,
		SkippedRecords: skippedRecords,
		StatusCounts:   statusCounts,
		Evaluations:    evaluations,
	}
	if end < total {
		page.NextCursor = strconv.Itoa(end)
	}
	return page, nil
}

func (s *Service) allExperimentSummaries(now time.Time) ([]api.QualityExperimentSummary, int, error) {
	records, skippedRecords, err := s.fs.ReadExperimentRecords()
	if err != nil {
		return nil, 0, err
	}
	var running []api.QualityExperimentSummary
	if s.bus != nil {
		running = s.bus.RunningExperimentSummaries(now)
	}
	summaries := make([]api.QualityExperimentSummary, 0, len(running)+len(records))
	summaries = append(summaries, running...)
	for _, file := range records {
		summaries = append(summaries, experimentSummary(file.Record))
	}
	sortExperimentSummariesNewestFirst(summaries)
	return summaries, skippedRecords, nil
}

func normalizeQualityExperimentsOptions(opts api.QualityExperimentsOptions) api.QualityExperimentsOptions {
	if opts.Window == "" {
		opts.Window = qualityOverviewWindowAll
	}
	if opts.Limit <= 0 {
		opts.Limit = qualityExperimentsDefaultLimit
	}
	if opts.Limit > qualityExperimentsMaxLimit {
		opts.Limit = qualityExperimentsMaxLimit
	}
	if opts.Offset < 0 {
		opts.Offset = 0
	}
	return opts
}

func qualityExperimentSummaryInWindow(summary api.QualityExperimentSummary, window qualityOverviewWindow) bool {
	if !window.Bounded {
		return true
	}
	at, ok := parseQualityTime(summary.StartedAt)
	return ok && overviewWindowContains(window, at)
}

func qualityExperimentStatusCounts(rows []api.QualityExperimentSummary) api.QualityExperimentStatusCounts {
	counts := api.QualityExperimentStatusCounts{All: len(rows)}
	for _, row := range rows {
		switch row.Status {
		case "passed":
			counts.Passed++
		case "failed":
			counts.Failed++
		case "informational":
			counts.Informational++
		case "running":
			counts.Running++
		}
	}
	return counts
}

func sortExperimentSummariesNewestFirst(summaries []api.QualityExperimentSummary) {
	sort.SliceStable(summaries, func(i, j int) bool {
		leftAt, leftOK := parseQualityTime(nonEmptyString(summaries[i].StartedAt, summaries[i].EndedAt))
		rightAt, rightOK := parseQualityTime(nonEmptyString(summaries[j].StartedAt, summaries[j].EndedAt))
		if leftOK && rightOK && !leftAt.Equal(rightAt) {
			return leftAt.After(rightAt)
		}
		if leftOK != rightOK {
			return leftOK
		}
		leftKey := nonEmptyString(summaries[i].StartedAt, summaries[i].EndedAt, summaries[i].ExperimentID)
		rightKey := nonEmptyString(summaries[j].StartedAt, summaries[j].EndedAt, summaries[j].ExperimentID)
		if leftKey == rightKey {
			return summaries[i].ExperimentID > summaries[j].ExperimentID
		}
		return leftKey > rightKey
	})
}

func experimentSummary(record qualityfs.ExperimentRecord) api.QualityExperimentSummary {
	summary := api.QualityExperimentSummary{
		ExperimentID:       record.ExperimentID,
		EvaluationID:       record.EvaluationID,
		QualityID:          record.QualityID,
		ExperimentLabel:    record.ExperimentLabel,
		StartedAt:          record.StartedAt,
		EndedAt:            record.EndedAt,
		Status:             experimentSummaryStatus(record),
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

func experimentSummaryStatus(record qualityfs.ExperimentRecord) string {
	if record.Gates.Informational {
		return "informational"
	}
	if record.Passed {
		return "passed"
	}
	return "failed"
}

// ExperimentRecordAPI returns one spec-02 experiment record VERBATIM — the
// stored bytes, never a struct round-trip (the schema evolves additively).
func (s *Service) ExperimentRecordAPI(_ context.Context, experimentID string) (json.RawMessage, bool, error) {
	return s.fs.ReadExperimentRecordRaw(experimentID)
}

// BaselineRecordsAPI lists all committed spec-02 baseline records verbatim,
// newest promotion first.
func (s *Service) BaselineRecordsAPI(_ context.Context) ([]json.RawMessage, error) {
	records, _, err := s.fs.ReadBaselineRecords()
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
	return s.fs.ReadBaselineRecordRaw(evaluationID)
}

// CassetteFilesAPI lists the engine's executor-boundary cassettes with the
// 90-day staleness flag the replay layer applies.
func (s *Service) CassetteFilesAPI(_ context.Context) ([]api.QualityCassetteFileRecord, error) {
	infos, err := s.fs.ReadCassetteFiles(time.Now())
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
func (s *Service) OverviewRecordAPI(ctx context.Context, windows ...string) (api.QualityOverviewRecord, error) {
	now := time.Now().UTC()
	windowName := qualityOverviewWindowAll
	if len(windows) > 0 && windows[0] != "" {
		windowName = windows[0]
	}
	window := newQualityOverviewWindow(windowName, now)
	fs := s.fs
	experiments, experimentSkipped, err := fs.ReadExperimentRecords()
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	experiments = filterSpecExperimentsForOverviewWindow(experiments, window)
	baselines, baselineSkipped, err := fs.ReadBaselineRecords()
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	baselines = filterBaselinesForOverviewWindow(baselines, window)
	cassettes, err := fs.ReadCassetteFiles(now)
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	cassettes = filterCassettesForOverviewWindow(cassettes, window)

	var runs []qualityRunRecord
	if s.obs != nil {
		runs, err = buildQualityRunsFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store))
		if err != nil {
			return api.QualityOverviewRecord{}, err
		}
	}
	runs = filterRunsForOverviewWindow(runs, window)
	insights, err := buildQualityInsightsFromInputs(fs, runs, experiments, now)
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	s.publishDerivedInsightChanges(insights)
	if snapshot, err := fs.Snapshot(); err == nil {
		s.publishCassetteDriftChanges(snapshot.Cassettes)
	}
	feedback, err := s.Feedback(ctx)
	if err != nil {
		return api.QualityOverviewRecord{}, err
	}
	feedback = filterFeedbackForOverviewWindow(feedback, window)

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
		SkippedRecords:             experimentSkipped + baselineSkipped,
		CassetteCount:              len(cassettes),
		FeedbackCount:              len(feedback),
		FeedbackNeedingReviewCount: feedbackNeedingReview,
		InsightCount:               len(insights),
		TotalCost:                  qualityTotalCost(runs),
		PassRateHistory:            specPassRateHistoryForOverviewWindow(experiments, window),
		OpenInsightsHistory:        qualityOpenInsightsHistory(insights),
		PassRateSpark:              qualityOverviewPassRateSpark(runs, window),
		CostSpark:                  qualityOverviewCostSpark(runs, window),
		LatencySpark:               qualityOverviewLatencySpark(runs, window),
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
	raw, found, err := s.fs.ReadExperimentRecordRaw(experimentID)
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
	records, _, err := s.fs.ReadBaselineRecords()
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

// EvaluationExperimentsAPI lists recent experiment summaries for one
// evaluation. Unlike the progress read model, this is a collection relation:
// unknown or not-yet-run evaluation ids return an empty relation, not a 404.
func (s *Service) EvaluationExperimentsAPI(_ context.Context, evaluationID string, limit int) (api.QualityEvaluationExperiments, error) {
	records, _, err := s.fs.ReadExperimentRecords()
	if err != nil {
		return api.QualityEvaluationExperiments{}, err
	}
	matching := make([]qualityfs.ExperimentRecord, 0, len(records))
	for _, file := range records {
		if file.Record.EvaluationID == evaluationID {
			matching = append(matching, file.Record)
		}
	}
	sortExperimentRecordsNewestFirst(matching)

	effectiveLimit := normalizeEvaluationProgressLimit(limit)
	total := len(matching)
	if len(matching) > effectiveLimit {
		matching = matching[:effectiveLimit]
	}

	relation := api.QualityEvaluationExperiments{
		Tag:           "QualityEvaluationExperiments",
		SchemaVersion: 1,
		EvaluationID:  evaluationID,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Limit:         effectiveLimit,
		Total:         total,
		Experiments:   make([]api.QualityExperimentSummary, 0, len(matching)),
	}
	for _, record := range matching {
		relation.Experiments = append(relation.Experiments, experimentSummary(record))
	}
	return relation, nil
}

// EvaluationExperimentGroupsAPI groups recent experiment summaries by
// evaluation for list screens that need the relation without client-side
// scans over every experiment row.
func (s *Service) EvaluationExperimentGroupsAPI(_ context.Context, limit int) (api.QualityEvaluationExperimentGroups, error) {
	records, _, err := s.fs.ReadExperimentRecords()
	if err != nil {
		return api.QualityEvaluationExperimentGroups{}, err
	}
	effectiveLimit := normalizeEvaluationProgressLimit(limit)
	type groupWork struct {
		evaluationID string
		latestKey    string
		records      []qualityfs.ExperimentRecord
	}
	byEvaluation := map[string]*groupWork{}
	for _, file := range records {
		evaluationID := file.Record.EvaluationID
		if evaluationID == "" {
			continue
		}
		group := byEvaluation[evaluationID]
		if group == nil {
			group = &groupWork{evaluationID: evaluationID}
			byEvaluation[evaluationID] = group
		}
		group.records = append(group.records, file.Record)
	}

	groups := make([]groupWork, 0, len(byEvaluation))
	totalExperiments := 0
	for _, group := range byEvaluation {
		sortExperimentRecordsNewestFirst(group.records)
		if len(group.records) > 0 {
			group.latestKey = qualityExperimentProgressSortKey(group.records[0])
		}
		totalExperiments += len(group.records)
		groups = append(groups, *group)
	}
	sort.SliceStable(groups, func(i, j int) bool {
		if groups[i].latestKey == groups[j].latestKey {
			return groups[i].evaluationID < groups[j].evaluationID
		}
		return groups[i].latestKey > groups[j].latestKey
	})

	out := api.QualityEvaluationExperimentGroups{
		Tag:              "QualityEvaluationExperimentGroups",
		SchemaVersion:    1,
		GeneratedAt:      time.Now().UTC().Format(time.RFC3339Nano),
		Limit:            effectiveLimit,
		TotalEvaluations: len(groups),
		TotalExperiments: totalExperiments,
		Groups:           make([]api.QualityEvaluationExperimentGroup, 0, len(groups)),
	}
	for _, group := range groups {
		records := group.records
		if len(records) > effectiveLimit {
			records = records[:effectiveLimit]
		}
		relation := api.QualityEvaluationExperimentGroup{
			EvaluationID: group.evaluationID,
			Total:        len(group.records),
			Experiments:  make([]api.QualityExperimentSummary, 0, len(records)),
		}
		for _, record := range records {
			relation.Experiments = append(relation.Experiments, experimentSummary(record))
		}
		out.Groups = append(out.Groups, relation)
	}
	return out, nil
}

// EvaluationProgressAPI builds the server-owned progress read model for one
// evaluation from recent spec-02 experiment records and the current baseline.
func (s *Service) EvaluationProgressAPI(_ context.Context, evaluationID string, limit int) (api.QualityEvaluationProgress, bool, error) {
	fs := s.fs
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
	sortExperimentRecordsNewestFirst(matching)

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

func sortExperimentRecordsNewestFirst(records []qualityfs.ExperimentRecord) {
	sort.SliceStable(records, func(i, j int) bool {
		left := qualityExperimentProgressSortKey(records[i])
		right := qualityExperimentProgressSortKey(records[j])
		if left == right {
			return records[i].ExperimentID > records[j].ExperimentID
		}
		return left > right
	})
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
	records, _, err := s.fs.ReadExperimentRecords()
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
		for _, cell := range record.Cells {
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
