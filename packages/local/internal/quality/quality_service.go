package quality

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// Service is the local-dev quality workbench boundary.
// Native clients subscribe to Events directly; HTTP handlers expose the same
// service to the web UI as a stable adapter.
type Service struct {
	store *store.Store
	dir   string
	bus   *EventBus
	obs   *observability.Service
}

func NewService(s *store.Store, dir string) *Service {
	return &Service{
		store: s,
		dir:   dir,
		bus:   NewEventBus(dir),
	}
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

func (s *Service) Overview(ctx context.Context) (qualityOverviewRecord, error) {
	if s.obs != nil {
		runs, err := buildQualityRunsFromObservability(ctx, s.obs, s.dir)
		if err != nil {
			return qualityOverviewRecord{}, err
		}
		return buildQualityOverviewWithRuns(s.store, s.dir, runs)
	}
	return buildQualityOverviewWithRuns(s.store, s.dir, nil)
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
		all, err = buildQualityRunsFromObservability(ctx, s.obs, s.dir)
	} else {
		all = []qualityRunRecord{}
	}
	if err != nil {
		return nil, err
	}
	return applyRunsOptions(all, opts), nil
}

func (s *Service) RunDetail(ctx context.Context, traceID string) (qualityRunDetailRecord, bool, error) {
	if s.obs != nil {
		detail, found, err := buildQualityRunDetailFromObservability(ctx, s.obs, s.dir, traceID)
		if err != nil || found {
			return detail, found, err
		}
	}
	return qualityRunDetailRecord{}, false, nil
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
	return buildQualitySuites(s.dir)
}

func (s *Service) Suite(_ context.Context, suiteID string) (qualitySuiteRecord, bool, error) {
	return buildQualitySuiteDetail(s.dir, suiteID)
}

func (s *Service) SaveSuite(_ context.Context, req qualitySuiteRecord) (qualitySuiteRecord, error) {
	record, err := saveQualitySuite(s.dir, req)
	if err == nil {
		s.publishWriteActivity("dataset", "suite saved", record.SuiteID)
	}
	return record, err
}

func (s *Service) UpsertSuiteCase(_ context.Context, suiteID string, req qualitySuiteCase) (qualitySuiteRecord, error) {
	record, err := upsertQualitySuiteCase(s.dir, suiteID, req)
	if err == nil {
		s.publishWriteActivity("dataset", "suite case saved", suiteID)
	}
	return record, err
}

func (s *Service) Insights(ctx context.Context) ([]qualityInsightRecord, error) {
	runs := []qualityRunRecord{}
	if s.obs != nil {
		var err error
		runs, err = buildQualityRunsFromObservability(ctx, s.obs, s.dir)
		if err != nil {
			return nil, err
		}
	}
	insights, err := buildQualityInsightsFromRuns(s.dir, runs)
	if err != nil {
		return nil, err
	}
	return enrichQualityInsightsWithCatalog(insights, s.store.GetCatalog(), s.dir, runs)
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
	return readQualityInsightSilences(s.dir, includeDeleted)
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
	return readQualityExperimentRecords(s.dir)
}

func (s *Service) Experiment(_ context.Context, experimentID string) (qualityExperimentRecord, error) {
	return readQualityExperiment(s.dir, experimentID)
}

func (s *Service) Comparisons(_ context.Context) ([]json.RawMessage, error) {
	return readQualityRecords(s.dir, "comparisons")
}

func (s *Service) Comparison(_ context.Context, comparisonID string) (json.RawMessage, error) {
	return readQualityRecord(s.dir, "comparisons", comparisonID)
}

func (s *Service) CreateComparison(_ context.Context, req qualityComparisonPostRequest) (qualityComparisonRecord, error) {
	record, err := createQualityComparison(s.dir, req)
	if err != nil {
		return record, err
	}
	if err := writeQualityRecord(s.dir, "comparisons", record.ID, record); err != nil {
		return record, err
	}
	s.publishWriteActivity("experiment", "comparison created", record.ID)
	return record, nil
}

func (s *Service) Baselines(_ context.Context) ([]json.RawMessage, error) {
	return readQualityRecords(s.dir, "baselines")
}

func (s *Service) Baseline(_ context.Context, baselineID string) (json.RawMessage, error) {
	return readQualityRecord(s.dir, "baselines", baselineID)
}

func (s *Service) CreateBaseline(_ context.Context, req qualityBaselinePostRequest) (qualityBaselineRecord, error) {
	record, err := createQualityBaseline(s.dir, req)
	if err != nil {
		return record, err
	}
	if err := writeQualityRecord(s.dir, "baselines", record.ID, record); err != nil {
		return record, err
	}
	s.publishWriteActivity("experiment", "baseline promoted", record.ID)
	return record, nil
}

func (s *Service) Cassettes(_ context.Context) ([]qualityCassetteSummary, error) {
	return readQualityCassettes(filepath.Join(s.dir, "cassettes"))
}

func (s *Service) CreateCassetteIssue(_ context.Context, req qualityCassetteIssueRecord) (qualityCassetteIssueRecord, error) {
	record, err := persistQualityCassetteIssue(s.dir, req)
	if err == nil {
		s.publishWriteActivity("cassette", "cassette issue saved", record.Path)
	}
	return record, err
}

func (s *Service) Feedback(_ context.Context) ([]qualityFeedbackRecord, error) {
	return readQualityFeedbackRecords(s.dir)
}

func (s *Service) FeedbackAnnotations(_ context.Context) ([]json.RawMessage, error) {
	return readQualityJSONLines(filepath.Join(s.dir, "feedback", "annotations.jsonl"))
}

func (s *Service) MemoryProposals(_ context.Context) ([]json.RawMessage, error) {
	return readQualityJSONLines(filepath.Join(s.dir, "feedback", "memory-proposals.jsonl"))
}

func (s *Service) CreateFeedbackAnnotation(_ context.Context, req qualityFeedbackAnnotationPostRequest) (qualityFeedbackAnnotationRecord, error) {
	record, err := createQualityFeedbackAnnotation(s.dir, req)
	if err == nil {
		s.publishWriteActivity("feedback", "feedback annotation saved", record.ID)
	}
	return record, err
}

func (s *Service) Scorers(_ context.Context) ([]qualityScorerRecord, error) {
	return buildQualityScorers(s.dir)
}

func (s *Service) CreateFeedback(_ context.Context, req qualityFeedbackPostRequest) (qualityFeedbackRecord, error) {
	record := qualityFeedbackRecord{
		Tag:          "QualityFeedback",
		ID:           fmt.Sprintf("feedback-%d", time.Now().UnixNano()),
		QualityID:    "local",
		CreatedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Status:       "new",
		TraceID:      req.TraceID,
		ExperimentID: req.ExperimentID,
		CaseID:       req.CaseID,
		Rating:       req.Rating,
		Comment:      req.Comment,
		Expected:     req.Expected,
		Tags:         req.Tags,
		Metadata:     req.Metadata,
	}
	if err := appendQualityJSONLine(filepath.Join(s.dir, "feedback", "inbox.jsonl"), record); err != nil {
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
