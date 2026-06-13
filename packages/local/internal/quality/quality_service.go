package quality

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ErrNotFound marks a quality record lookup that resolved no record, so
// callers can distinguish missing records from read failures.
var ErrNotFound = errors.New("quality record not found")

// Service is the local-dev quality workbench boundary.
// Native clients subscribe to Events directly; HTTP handlers expose the same
// service to the web UI as a stable adapter.
type Service struct {
	store *store.Store
	dir   string
	bus   *EventBus
	obs   *observability.Service
}

func toAPI[T any](value any, err error) (T, error) {
	var out T
	if err != nil {
		return out, err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return out, err
	}
	return out, json.Unmarshal(data, &out)
}

func toRawMessages[T any](records []T) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, 0, len(records))
	for _, record := range records {
		data, err := json.Marshal(record)
		if err != nil {
			return nil, err
		}
		out = append(out, append(json.RawMessage(nil), data...))
	}
	return out, nil
}

func NewService(s *store.Store, dir string) *Service {
	return &Service{
		store: s,
		dir:   dir,
		bus:   NewEventBus(dir),
	}
}

func (s *Service) Dir() string {
	if s == nil {
		return ""
	}
	return s.dir
}

func (s *Service) Events() *EventBus {
	return s.bus
}

func (s *Service) WithObservability(obs *observability.Service) *Service {
	s.obs = obs
	return s
}

func (s *Service) RecentActivity(_ context.Context, limit int) ([]api.QualityActivityEvent, error) {
	return s.bus.RecentActivity(limit), nil
}

func (s *Service) ActivityAPI(ctx context.Context, limit int) ([]api.QualityActivityEvent, error) {
	return s.RecentActivity(ctx, limit)
}

func (s *Service) Overview(ctx context.Context) (qualityOverviewRecord, error) {
	if s.obs != nil {
		runs, err := buildQualityRunsFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store))
		if err != nil {
			return qualityOverviewRecord{}, err
		}
		return buildQualityOverviewWithRuns(s.store, s.dir, runs)
	}
	return buildQualityOverviewWithRuns(s.store, s.dir, nil)
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) OverviewAPI(ctx context.Context) (api.QualityOverviewRecord, error) {
	return toAPI[api.QualityOverviewRecord](s.Overview(ctx))
}

// Runs returns all runs (root traces with descendants folded in).
// Equivalent to RunsWithOptions(ctx, QualityRunsOptions{}).
func (s *Service) Runs(ctx context.Context) ([]qualityRunRecord, error) {
	return s.RunsWithOptions(ctx, api.QualityRunsOptions{})
}

// RunsWithOptions returns runs filtered/sorted/limited per opts. Empty
// options return everything in newest-first time order.
func (s *Service) RunsWithOptions(ctx context.Context, opts api.QualityRunsOptions) ([]qualityRunRecord, error) {
	var all []qualityRunRecord
	var err error
	if s.obs != nil {
		all, err = buildQualityRunsFromObservabilityWithOptions(ctx, s.obs, s.dir, projectRootFromStore(s.store), observabilityRunListOptionsForQuality(opts))
	} else {
		all = []qualityRunRecord{}
	}
	if err != nil {
		return nil, err
	}
	return applyRunsOptions(all, opts), nil
}

func (s *Service) RunsWithOptionsAPI(ctx context.Context, opts api.QualityRunsOptions) ([]api.QualityRunRecord, error) {
	return toAPI[[]api.QualityRunRecord](s.RunsWithOptions(ctx, opts))
}

func observabilityRunListOptionsForQuality(opts api.QualityRunsOptions) observability.RunListOptions {
	if opts.Limit <= 0 {
		if opts.Offset > 0 {
			return observability.RunListOptions{Limit: observability.DefaultRunListLimit + opts.Offset}
		}
		return observability.RunListOptions{}
	}
	return observability.RunListOptions{Limit: opts.Limit + opts.Offset}
}

func (s *Service) RunDetail(ctx context.Context, traceID string) (qualityRunDetailRecord, bool, error) {
	if s.obs != nil {
		detail, found, err := buildQualityRunDetailFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store), traceID)
		if err != nil || found {
			return detail, found, err
		}
	}
	return qualityRunDetailRecord{}, false, nil
}

func (s *Service) RunDetailAPI(ctx context.Context, traceID string) (api.QualityRunDetailRecord, bool, error) {
	record, found, err := s.RunDetail(ctx, traceID)
	if err != nil {
		return api.QualityRunDetailRecord{}, false, err
	}
	var out api.QualityRunDetailRecord
	if !found {
		return out, false, nil
	}
	out, err = toAPI[api.QualityRunDetailRecord](record, nil)
	return out, err == nil, err
}

func (s *Service) DeleteRuns(ctx context.Context, traceIDs []string) (api.QualityDeleteRunsRecord, error) {
	requested := uniqueQualityIDs(traceIDs)
	record := api.QualityDeleteRunsRecord{
		Tag:      "QualityDeleteRuns",
		TraceIDs: requested,
	}
	if len(requested) == 0 {
		return record, nil
	}

	deleted := []string{}
	matchedRequested := make(map[string]struct{})
	if s.obs != nil {
		resolved, err := s.obs.ResolveRunIDs(ctx, requested)
		if err != nil {
			return record, err
		}
		for requestedID := range resolved {
			matchedRequested[requestedID] = struct{}{}
		}
		var deleteErr error
		deleted, deleteErr = s.obs.DeleteRuns(ctx, requested)
		if deleteErr != nil {
			return record, deleteErr
		}
	}

	for _, traceID := range requested {
		if _, matched := matchedRequested[traceID]; matched {
			continue
		}
		found := false
		for _, runID := range deleted {
			if runID == traceID {
				found = true
				break
			}
		}
		if !found {
			record.MissingTraceIDs = append(record.MissingTraceIDs, traceID)
		}
	}
	record.DeletedTraceIDs = deleted

	if len(record.DeletedTraceIDs) > 0 {
		payload, _ := json.Marshal(record)
		s.bus.Publish(api.QualityEvent{
			Kind:     "run",
			Action:   "deleted",
			Severity: "info",
			RefID:    record.DeletedTraceIDs[0],
			Payload:  payload,
		})
		s.publishWriteActivity("run", "run deleted", record.DeletedTraceIDs[0])
	}
	return record, nil
}

func (s *Service) Suites(_ context.Context) ([]qualitySuiteRecord, error) {
	return buildQualitySuites(s.dir, s.store.GetIndex())
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) SuitesAPI(ctx context.Context) ([]api.QualitySuiteRecord, error) {
	return toAPI[[]api.QualitySuiteRecord](s.Suites(ctx))
}

func (s *Service) Suite(_ context.Context, suiteID string) (qualitySuiteRecord, bool, error) {
	return buildQualitySuiteDetail(s.dir, s.store.GetIndex(), suiteID)
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) SuiteAPI(ctx context.Context, suiteID string) (api.QualitySuiteRecord, bool, error) {
	record, found, err := s.Suite(ctx, suiteID)
	if err != nil || !found {
		return api.QualitySuiteRecord{}, found, err
	}
	out, err := toAPI[api.QualitySuiteRecord](record, nil)
	return out, err == nil, err
}

func (s *Service) SaveSuite(_ context.Context, req qualitySuiteRecord) (qualitySuiteRecord, error) {
	record, err := persistQualitySuite(s.dir, req)
	if err == nil {
		s.publishWriteActivity("dataset", "suite saved", record.SuiteID)
	}
	return record, err
}

func (s *Service) UpsertSuiteCase(_ context.Context, suiteID string, req qualitySuiteCase) (qualitySuiteRecord, error) {
	record, err := persistQualitySuiteCase(s.dir, suiteID, req)
	if err == nil {
		s.publishWriteActivity("dataset", "suite case saved", suiteID)
	}
	return record, err
}

func (s *Service) Insights(ctx context.Context) ([]qualityInsightRecord, error) {
	runs := []qualityRunRecord{}
	if s.obs != nil {
		var err error
		runs, err = buildQualityRunsFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store))
		if err != nil {
			return nil, err
		}
	}
	insights, err := buildQualityInsightsFromRuns(s.dir, runs)
	if err != nil {
		return nil, err
	}
	return enrichQualityInsightsWithIndex(insights, s.store.GetIndex(), s.dir, runs)
}

func (s *Service) InsightsAPI(ctx context.Context) ([]api.QualityInsightRecord, error) {
	return toAPI[[]api.QualityInsightRecord](s.Insights(ctx))
}

func (s *Service) SetInsightStatus(ctx context.Context, insightID string, req qualityInsightStatusRequest) (qualityInsightStatusRecord, error) {
	resolvedOccurrences := 0
	if req.Status == "resolved" {
		insights, err := s.Insights(ctx)
		if err != nil {
			return qualityInsightStatusRecord{}, err
		}
		for _, insight := range insights {
			if insight.InsightID == insightID {
				resolvedOccurrences = insight.OccurrenceCount
				break
			}
		}
	}
	record, err := persistQualityInsightStatus(s.dir, insightID, req, resolvedOccurrences)
	if err == nil {
		s.publishWriteActivity("insight", "insight status updated", insightID)
	}
	return record, err
}

func (s *Service) InsightSilences(_ context.Context, includeDeleted bool) ([]qualityInsightSilenceRecord, error) {
	return qualityInsightSilences(s.dir, includeDeleted)
}

func (s *Service) InsightSilencesAPI(ctx context.Context, includeDeleted bool) ([]api.QualityInsightSilenceRecord, error) {
	return toAPI[[]api.QualityInsightSilenceRecord](s.InsightSilences(ctx, includeDeleted))
}

func (s *Service) CreateInsightSilence(ctx context.Context, req qualityInsightSilenceRequest) (qualityInsightSilenceRecord, error) {
	if req.Pattern == nil && req.InsightID != nil && *req.InsightID != "" {
		insights, err := s.Insights(ctx)
		if err != nil {
			return qualityInsightSilenceRecord{}, err
		}
		for _, insight := range insights {
			if insight.InsightID == *req.InsightID {
				req.Pattern = &qualityInsightSilencePattern{Title: insight.Title, TargetID: insight.TargetID}
				break
			}
		}
		if req.Pattern == nil {
			return qualityInsightSilenceRecord{}, fmt.Errorf("insight %q not found", *req.InsightID)
		}
	}
	record, err := persistQualityInsightSilence(s.dir, req)
	if err == nil {
		s.publishWriteActivity("insight", "insight pattern silenced", record.ID)
	}
	return record, err
}

func (s *Service) DeleteInsightSilence(_ context.Context, silenceID string) (qualityInsightSilenceRecord, error) {
	record, err := deleteQualityInsightSilence(s.dir, silenceID)
	if err == nil {
		s.publishWriteActivity("insight", "insight silence removed", silenceID)
	}
	return record, err
}

func (s *Service) Experiments(_ context.Context) ([]qualityExperimentRecord, error) {
	snapshot, err := qualityfs.Open(s.dir).Snapshot()
	return snapshot.Experiments, err
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) ExperimentsAPI(ctx context.Context) ([]api.QualityExperimentRecord, error) {
	return toAPI[[]api.QualityExperimentRecord](s.Experiments(ctx))
}

func (s *Service) Experiment(_ context.Context, experimentID string) (qualityExperimentRecord, error) {
	snapshot, err := qualityfs.Open(s.dir).Snapshot()
	if err != nil {
		return qualityExperimentRecord{}, err
	}
	record, ok := snapshot.ByID.Experiments[experimentID]
	if !ok {
		return qualityExperimentRecord{}, fmt.Errorf("quality experiment %q not found: %w", experimentID, ErrNotFound)
	}
	return record, nil
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) ExperimentAPI(ctx context.Context, experimentID string) (api.QualityExperimentRecord, bool, error) {
	record, err := s.Experiment(ctx, experimentID)
	if errors.Is(err, ErrNotFound) {
		return api.QualityExperimentRecord{}, false, nil
	}
	if err != nil {
		return api.QualityExperimentRecord{}, false, err
	}
	out, err := toAPI[api.QualityExperimentRecord](record, nil)
	return out, err == nil, err
}

func (s *Service) Comparisons(_ context.Context) ([]json.RawMessage, error) {
	snapshot, err := qualityfs.Open(s.dir).Snapshot()
	if err != nil {
		return nil, err
	}
	return toRawMessages(snapshot.Comparisons)
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) ComparisonsAPI(ctx context.Context) ([]api.QualityComparisonRecord, error) {
	return toAPI[[]api.QualityComparisonRecord](s.Comparisons(ctx))
}

func (s *Service) Comparison(_ context.Context, comparisonID string) (json.RawMessage, error) {
	record, found, err := qualityfs.Open(s.dir).ReadRaw(qualityfs.KindComparisons, comparisonID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("quality comparison %q not found: %w", comparisonID, ErrNotFound)
	}
	return record, nil
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) ComparisonAPI(ctx context.Context, comparisonID string) (api.QualityComparisonRecord, bool, error) {
	record, err := s.Comparison(ctx, comparisonID)
	if errors.Is(err, ErrNotFound) {
		return api.QualityComparisonRecord{}, false, nil
	}
	if err != nil {
		return api.QualityComparisonRecord{}, false, err
	}
	out, err := toAPI[api.QualityComparisonRecord](record, nil)
	return out, err == nil, err
}

func (s *Service) CreateComparison(_ context.Context, req qualityComparisonPostRequest) (qualityComparisonRecord, error) {
	record, err := createQualityComparison(s.dir, req)
	if err != nil {
		return record, err
	}
	if _, err := qualityfs.Put(qualityfs.Open(s.dir), record); err != nil {
		return record, err
	}
	s.publishWriteActivity("experiment", "comparison created", record.ID)
	return record, nil
}

func (s *Service) Baselines(_ context.Context) ([]json.RawMessage, error) {
	snapshot, err := qualityfs.Open(s.dir).Snapshot()
	if err != nil {
		return nil, err
	}
	return toRawMessages(snapshot.Baselines)
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) BaselinesAPI(ctx context.Context) ([]api.QualityBaselineRecord, error) {
	return toAPI[[]api.QualityBaselineRecord](s.Baselines(ctx))
}

func (s *Service) Baseline(_ context.Context, baselineID string) (json.RawMessage, error) {
	record, found, err := qualityfs.Open(s.dir).ReadRaw(qualityfs.KindBaselines, baselineID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("quality baseline %q not found: %w", baselineID, ErrNotFound)
	}
	return record, nil
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) BaselineAPI(ctx context.Context, baselineID string) (api.QualityBaselineRecord, bool, error) {
	record, err := s.Baseline(ctx, baselineID)
	if errors.Is(err, ErrNotFound) {
		return api.QualityBaselineRecord{}, false, nil
	}
	if err != nil {
		return api.QualityBaselineRecord{}, false, err
	}
	out, err := toAPI[api.QualityBaselineRecord](record, nil)
	return out, err == nil, err
}

func (s *Service) CreateBaseline(_ context.Context, req qualityBaselinePostRequest) (qualityBaselineRecord, error) {
	record, err := createQualityBaseline(s.dir, req)
	if err != nil {
		return record, err
	}
	if _, err := qualityfs.Put(qualityfs.Open(s.dir), record); err != nil {
		return record, err
	}
	s.publishWriteActivity("experiment", "baseline promoted", record.ID)
	return record, nil
}

func (s *Service) Cassettes(_ context.Context) ([]qualityCassetteSummary, error) {
	projectRoot := ""
	if index := s.store.GetIndex(); index.Project != nil {
		projectRoot = index.Project.Root
	}
	snapshot, err := qualityfs.Open(s.dir).Snapshot(qualityfs.WithProjectCassettes(projectRoot))
	return snapshot.Cassettes, err
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) CassettesAPI(ctx context.Context) ([]api.QualityCassetteRecord, error) {
	return toAPI[[]api.QualityCassetteRecord](s.Cassettes(ctx))
}

func (s *Service) CreateCassetteIssue(_ context.Context, req qualityCassetteIssueRecord) (qualityCassetteIssueRecord, error) {
	record, err := qualityfs.Put(qualityfs.Open(s.dir), req)
	if err == nil {
		s.publishWriteActivity("cassette", "cassette issue saved", record.Path)
	}
	return record, err
}

func (s *Service) Feedback(_ context.Context) ([]qualityFeedbackRecord, error) {
	snapshot, err := qualityfs.Open(s.dir).Snapshot()
	return snapshot.Feedback, err
}

func (s *Service) FeedbackAPI(ctx context.Context) ([]api.QualityFeedbackRecord, error) {
	return toAPI[[]api.QualityFeedbackRecord](s.Feedback(ctx))
}

func (s *Service) FeedbackAnnotations(_ context.Context) ([]json.RawMessage, error) {
	return qualityfs.Open(s.dir).ReadStream(qualityfs.StreamFeedbackAnnotations)
}

func (s *Service) FeedbackAnnotationsAPI(ctx context.Context) ([]api.QualityFeedbackAnnotationRecord, error) {
	return toAPI[[]api.QualityFeedbackAnnotationRecord](s.FeedbackAnnotations(ctx))
}

func (s *Service) MemoryProposals(_ context.Context) ([]json.RawMessage, error) {
	return qualityfs.Open(s.dir).ReadStream(qualityfs.StreamFeedbackMemory)
}

func (s *Service) MemoryProposalsAPI(ctx context.Context) ([]api.QualityFeedbackMemoryProposalRecord, error) {
	return toAPI[[]api.QualityFeedbackMemoryProposalRecord](s.MemoryProposals(ctx))
}

func (s *Service) CreateFeedbackAnnotation(_ context.Context, req qualityFeedbackAnnotationPostRequest) (qualityFeedbackAnnotationRecord, error) {
	record, err := qualityfs.Put(qualityfs.Open(s.dir), qualityFeedbackAnnotationRecord{
		FeedbackID: req.FeedbackID,
		Status:     req.Status,
		Note:       req.Note,
		Expected:   req.Expected,
		Tags:       req.Tags,
		Metadata:   req.Metadata,
	})
	if err == nil {
		s.publishWriteActivity("feedback", "feedback annotation saved", record.ID)
	}
	return record, err
}

func (s *Service) Scorers(_ context.Context) ([]qualityScorerRecord, error) {
	return buildQualityScorers(s.dir)
}

// Deprecated: pre-rewrite read model, quarantined under /api/quality/legacy/*
// for the TUI; the spec-02 read port (quality_spec_records.go) is the canonical
// surface. Removed with the devtools UI workstream — see the designer handover.
func (s *Service) ScorersAPI(ctx context.Context) ([]api.QualityScorerRecord, error) {
	return toAPI[[]api.QualityScorerRecord](s.Scorers(ctx))
}

func (s *Service) CreateFeedback(_ context.Context, req qualityFeedbackPostRequest) (qualityFeedbackRecord, error) {
	record, err := qualityfs.Put(qualityfs.Open(s.dir), qualityFeedbackRecord{
		TraceID:      req.TraceID,
		ExperimentID: req.ExperimentID,
		CaseID:       req.CaseID,
		Rating:       req.Rating,
		Comment:      req.Comment,
		Expected:     req.Expected,
		Tags:         req.Tags,
		Metadata:     req.Metadata,
	})
	if err != nil {
		return record, err
	}
	s.publishWriteActivity("feedback", "feedback saved", record.ID)
	return record, nil
}

func (s *Service) publishWriteActivity(kind, summary, refID string) {
	s.bus.PublishActivity(api.QualityActivityEvent{
		Tag:       "QualityActivityEvent",
		Timestamp: time.Now().UnixMilli(),
		Kind:      kind,
		Severity:  "info",
		Summary:   summary,
		RefID:     refID,
	})
}

func uniqueQualityIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
