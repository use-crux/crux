package inspect

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/inspectfs"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ErrNotFound marks a inspect record lookup that resolved no record, so
// callers can distinguish missing records from read failures.
var ErrNotFound = errors.New("inspect record not found")

// Service is the local-dev inspect workbench boundary.
// Native clients subscribe to Events directly; HTTP handlers expose the same
// service to the web UI as a stable adapter.
type Service struct {
	store *store.Store
	dir   string
	fs    *inspectfs.FS
	bus   *EventBus
	obs   *observability.Service

	derivedMu         sync.Mutex
	insightSignatures map[string]string
	insightsPrimed    bool
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
		store:             s,
		dir:               dir,
		fs:                inspectfs.Open(dir),
		bus:               NewEventBus(dir),
		insightSignatures: map[string]string{},
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

func (s *Service) RecentActivity(_ context.Context, limit int) ([]api.InspectActivityEvent, error) {
	return s.bus.RecentActivity(limit), nil
}

func (s *Service) ActivityAPI(ctx context.Context, limit int) ([]api.InspectActivityEvent, error) {
	return s.RecentActivity(ctx, limit)
}

// Runs returns all runs (root traces with descendants folded in).
// Equivalent to RunsWithOptions(ctx, InspectRunsOptions{}).
func (s *Service) Runs(ctx context.Context) ([]inspectRunRecord, error) {
	return s.RunsWithOptions(ctx, api.InspectRunsOptions{})
}

// RunsWithOptions returns runs filtered/sorted/limited per opts. Empty
// options return everything in newest-first time order.
func (s *Service) RunsWithOptions(ctx context.Context, opts api.InspectRunsOptions) ([]inspectRunRecord, error) {
	var all []inspectRunRecord
	var err error
	if s.obs != nil {
		all, err = buildInspectRunsFromObservabilityWithOptions(ctx, s.obs, s.dir, projectRootFromStore(s.store), observabilityRunListOptionsForInspect(opts))
	} else {
		all = []inspectRunRecord{}
	}
	if err != nil {
		return nil, err
	}
	return applyRunsOptions(all, opts), nil
}

func (s *Service) RunsWithOptionsAPI(ctx context.Context, opts api.InspectRunsOptions) ([]api.InspectRunRecord, error) {
	return toAPI[[]api.InspectRunRecord](s.RunsWithOptions(ctx, opts))
}

func observabilityRunListOptionsForInspect(opts api.InspectRunsOptions) observability.RunListOptions {
	return observability.RunListOptions{}
}

func (s *Service) RunDetail(ctx context.Context, traceID string) (inspectRunDetailRecord, bool, error) {
	if s.obs != nil {
		detail, found, err := buildInspectRunDetailFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store), traceID)
		if err != nil || found {
			return detail, found, err
		}
	}
	return inspectRunDetailRecord{}, false, nil
}

func (s *Service) RunDetailAPI(ctx context.Context, traceID string) (api.InspectRunDetailRecord, bool, error) {
	record, found, err := s.RunDetail(ctx, traceID)
	if err != nil {
		return api.InspectRunDetailRecord{}, false, err
	}
	var out api.InspectRunDetailRecord
	if !found {
		return out, false, nil
	}
	out, err = toAPI[api.InspectRunDetailRecord](record, nil)
	return out, err == nil, err
}

func (s *Service) DeleteRuns(ctx context.Context, traceIDs []string) (api.InspectDeleteRunsRecord, error) {
	requested := uniqueInspectIDs(traceIDs)
	record := api.InspectDeleteRunsRecord{
		Tag:      "InspectDeleteRuns",
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
		s.bus.Publish(api.InspectEvent{
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

func (s *Service) SetInsightStatus(ctx context.Context, insightID string, req inspectInsightStatusRequest) (inspectInsightStatusRecord, error) {
	resolvedOccurrences := 0
	if req.Status == "resolved" {
		insights, err := s.Insights(ctx)
		if err != nil {
			return inspectInsightStatusRecord{}, err
		}
		for _, insight := range insights {
			if insight.InsightID == insightID {
				resolvedOccurrences = insight.OccurrenceCount
				break
			}
		}
	}
	record, err := persistInspectInsightStatus(s.dir, insightID, req, resolvedOccurrences)
	if err == nil {
		s.publishWriteActivity("insight", "insight status updated", insightID)
	}
	return record, err
}

func (s *Service) InsightSilences(_ context.Context, includeDeleted bool) ([]inspectInsightSilenceRecord, error) {
	return inspectInsightSilences(s.dir, includeDeleted)
}

func (s *Service) InsightSilencesAPI(ctx context.Context, includeDeleted bool) ([]api.InspectInsightSilenceRecord, error) {
	return toAPI[[]api.InspectInsightSilenceRecord](s.InsightSilences(ctx, includeDeleted))
}

func (s *Service) CreateInsightSilence(ctx context.Context, req inspectInsightSilenceRequest) (inspectInsightSilenceRecord, error) {
	if req.Pattern == nil && req.InsightID != nil && *req.InsightID != "" {
		insights, err := s.Insights(ctx)
		if err != nil {
			return inspectInsightSilenceRecord{}, err
		}
		for _, insight := range insights {
			if insight.InsightID == *req.InsightID {
				req.Pattern = &inspectInsightSilencePattern{Title: insight.Title, TargetID: insight.TargetID}
				break
			}
		}
		if req.Pattern == nil {
			return inspectInsightSilenceRecord{}, fmt.Errorf("insight %q not found", *req.InsightID)
		}
	}
	record, err := persistInspectInsightSilence(s.dir, req)
	if err == nil {
		s.publishWriteActivity("insight", "insight pattern silenced", record.ID)
	}
	return record, err
}

func (s *Service) DeleteInsightSilence(_ context.Context, silenceID string) (inspectInsightSilenceRecord, error) {
	record, err := deleteInspectInsightSilence(s.dir, silenceID)
	if err == nil {
		s.publishWriteActivity("insight", "insight silence removed", silenceID)
	}
	return record, err
}

func (s *Service) publishWriteActivity(kind, summary, refID string) {
	s.bus.PublishActivity(api.InspectActivityEvent{
		Tag:       "InspectActivityEvent",
		Timestamp: time.Now().UnixMilli(),
		Kind:      kind,
		Severity:  "info",
		Summary:   summary,
		RefID:     refID,
	})
}

func uniqueInspectIDs(values []string) []string {
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
