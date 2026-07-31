package tui

import (
	"encoding/json"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

func invalidationsForScreen(screenID string, invalidations bridge.Invalidations) bridge.Invalidations {
	prefix := screenID + ":"
	affected := bridge.Invalidations{}
	for name, revision := range invalidations {
		if strings.HasPrefix(string(name), prefix) {
			affected.Add(name, revision)
		}
	}
	return affected
}

func invalidationsForBatch(batch bridge.Batch) bridge.Invalidations {
	invalidations := bridge.Invalidations{}
	if batch.Changed.Has(bridge.DomainRuns) {
		invalidations.Add(bridge.OverviewSummaryResource, batch.Revs.Activity)
		invalidations.Add(bridge.OverviewRunsResource, batch.Revs.Runs)
		addRunsInvalidations(invalidations, batch.Inspect)
	}
	if batch.Changed.Has(bridge.DomainEvals) {
		invalidations.Add(bridge.InsightsEvalRunsResource, batch.Revs.Evals)
		invalidations.Add(bridge.EvalsCatalogResource, batch.Revs.Evals)
		invalidations.Add(bridge.EvalsRunsResource, batch.Revs.Evals)
		invalidations.Add(bridge.EvalsAnyRunResource, batch.Revs.Evals)
	}
	if batch.Changed.Has(bridge.DomainBaselines) {
		invalidations.Add(bridge.EvalsBaselinesResource, batch.Revs.Baselines)
	}
	if batch.Changed.Has(bridge.DomainInsights) {
		invalidations.Add(bridge.OverviewSummaryResource, batch.Revs.Activity)
		invalidations.Add(bridge.OverviewInsightsResource, batch.Revs.Insights)
		invalidations.Add(bridge.InsightsListResource, batch.Revs.Insights)
	}
	if batch.Changed.Has(bridge.DomainActivity) {
		invalidations.Add(bridge.OverviewActivityResource, batch.Revs.Activity)
	}
	if batch.Changed.Has(bridge.DomainIndex) {
		invalidations.Add(bridge.IndexSnapshotResource, batch.Revs.Index)
		invalidations.Add(bridge.EvalsCatalogResource, batch.Revs.Index)
	}
	return invalidations
}

type runInvalidationPayload struct {
	OperationID         string   `json:"operationId"`
	OperationIDs        []string `json:"operationIds"`
	DeletedOperationIDs []string `json:"deletedOperationIds"`
	RunID               string   `json:"runId"`
	RunIDs              []string `json:"runIds"`
	TraceIDs            []string `json:"traceIds"`
	DeletedTraceIDs     []string `json:"deletedTraceIds"`
	Revision            int64    `json:"revision"`
}

func addRunsInvalidations(invalidations bridge.Invalidations, events []api.InspectEvent) {
	foundRunEvent := false
	for _, event := range events {
		if !bridge.DomainsForInspectEvent(event).Has(bridge.DomainRuns) {
			continue
		}
		foundRunEvent = true
		payload := decodeRunInvalidationPayload(event.Payload)
		revision := uint64(0)
		if payload.Revision > 0 {
			revision = uint64(payload.Revision)
		}
		invalidations.Add(bridge.RunsListResource, revision)
		ids := appendRunInvalidationIDs(nil, payload, event.RefID)
		if isObservabilityRefreshBatch(event) {
			ids = appendCompleteRunInvalidationIDs(nil, payload)
		}
		if len(ids) == 0 {
			invalidations.Add(bridge.RunsAnyDetailResource, revision)
			invalidations.Add(bridge.EvalsAnyLocalRunResource, revision)
			continue
		}
		for _, id := range ids {
			invalidations.Add(bridge.RunsDetailResource(id), revision)
			invalidations.Add(bridge.EvalsLocalRunResource(id), revision)
		}
	}
	if !foundRunEvent {
		invalidations.Add(bridge.RunsListResource, 0)
		invalidations.Add(bridge.RunsAnyDetailResource, 0)
		invalidations.Add(bridge.EvalsAnyLocalRunResource, 0)
	}
}

func isObservabilityRefreshBatch(event api.InspectEvent) bool {
	return strings.Contains(strings.ToLower(event.Kind), "refresh") &&
		strings.Contains(strings.ToLower(event.Action), "observability")
}

func appendCompleteRunInvalidationIDs(ids []string, payload runInvalidationPayload) []string {
	for _, group := range [][]string{payload.OperationIDs, payload.DeletedOperationIDs, payload.RunIDs, payload.DeletedTraceIDs, payload.TraceIDs} {
		for _, id := range group {
			ids = appendUniqueString(ids, id)
		}
	}
	return ids
}

func decodeRunInvalidationPayload(payload json.RawMessage) runInvalidationPayload {
	var decoded runInvalidationPayload
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &decoded)
	}
	return decoded
}

func appendRunInvalidationIDs(ids []string, payload runInvalidationPayload, fallback string) []string {
	ids = appendUniqueString(ids, payload.OperationID)
	ids = appendUniqueString(ids, payload.RunID)
	for _, group := range [][]string{payload.OperationIDs, payload.DeletedOperationIDs, payload.RunIDs, payload.DeletedTraceIDs, payload.TraceIDs} {
		for _, id := range group {
			ids = appendUniqueString(ids, id)
		}
	}
	if len(ids) == 0 {
		ids = appendUniqueString(ids, fallback)
	}
	return ids
}

func appendUniqueString(values []string, value string) []string {
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
