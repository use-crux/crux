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

// OverviewRecordAPI is the dashboard projection over the spec-02 tree.
func (s *Service) OverviewRecordAPI(ctx context.Context) (api.QualityWorkbenchOverview, error) {
	fs := qualityfs.Open(s.dir)
	experiments, legacySkipped, err := fs.ReadExperimentRecords()
	if err != nil {
		return api.QualityWorkbenchOverview{}, err
	}
	baselines, _, err := fs.ReadBaselineRecords()
	if err != nil {
		return api.QualityWorkbenchOverview{}, err
	}
	cassettes, err := fs.ReadCassetteFiles(time.Now())
	if err != nil {
		return api.QualityWorkbenchOverview{}, err
	}
	overview := api.QualityWorkbenchOverview{
		Experiments:              len(experiments),
		Baselines:                len(baselines),
		Cassettes:                len(cassettes),
		LegacyExperimentsSkipped: legacySkipped,
	}
	for _, cassette := range cassettes {
		if cassette.Stale {
			overview.StaleCassettes++
		}
	}
	if len(experiments) > 0 {
		newest := experiments[0].Record
		overview.LastExperiment = &api.QualityLastExperiment{
			ExperimentID: newest.ExperimentID,
			EvaluationID: newest.EvaluationID,
			EndedAt:      newest.EndedAt,
			Passed:       newest.Passed,
		}
	}
	return overview, nil
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
