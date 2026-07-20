package devtools

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/inspect"
)

// Typed write accessors JSON-roundtrip through the internal Inspect records.
// This is the
// in-process mirror of the equivalent `POST /api/inspect/...` HTTP routes.

// SetInsightStatus updates an insight's open/dismissed/resolved status.
func (c *DirectClient) SetInsightStatus(ctx context.Context, insightID string, req api.InspectInsightStatusRequest) (api.InspectInsightStatusRecord, error) {
	var out api.InspectInsightStatusRecord
	if c.inspect == nil {
		return out, errNoInspectService
	}
	var internal inspect.InsightStatusRequest
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.inspect.SetInsightStatus(ctx, insightID, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// DeleteRuns removes one or more Inspect run projections and their canonical
// observability records, then publishes the same Inspect event used by the HTTP
// DELETE route.
func (c *DirectClient) DeleteRuns(ctx context.Context, operationIDs []string) (api.InspectDeleteRunsRecord, error) {
	if c.inspect == nil {
		return api.InspectDeleteRunsRecord{}, errNoInspectService
	}
	return c.inspect.DeleteRuns(ctx, operationIDs)
}

func (c *DirectClient) InsightSilences(ctx context.Context, includeDeleted bool) ([]api.InspectInsightSilenceRecord, error) {
	if c.inspect == nil {
		return nil, errNoInspectService
	}
	recs, err := c.inspect.InsightSilences(ctx, includeDeleted)
	if err != nil {
		return nil, err
	}
	var out []api.InspectInsightSilenceRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) CreateInsightSilence(ctx context.Context, req api.InspectInsightSilenceRequest) (api.InspectInsightSilenceRecord, error) {
	var out api.InspectInsightSilenceRecord
	if c.inspect == nil {
		return out, errNoInspectService
	}
	var internal inspect.InsightSilenceRequest
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.inspect.CreateInsightSilence(ctx, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

func (c *DirectClient) DeleteInsightSilence(ctx context.Context, silenceID string) (api.InspectInsightSilenceRecord, error) {
	var out api.InspectInsightSilenceRecord
	if c.inspect == nil {
		return out, errNoInspectService
	}
	rec, err := c.inspect.DeleteInsightSilence(ctx, silenceID)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}
