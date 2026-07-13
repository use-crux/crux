package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/store"
)

var errNoQualityService = fmt.Errorf("quality service not configured")
var errNoObservabilityService = fmt.Errorf("observability service not configured")

// DirectClient exposes the devtools read API against an in-process store.
// It lets native clients use the same logical routes as the HTTP API without a
// loopback HTTP/WebSocket dependency.
// PromoteFunc runs a server-side baseline promotion (the embedded quality
// worker's --promote mode). Injected by the server wiring (commands/dev.go)
// because promotion spawns the worker, which lives in internal/server —
// importing it here would create a cycle.
type PromoteFunc func(ctx context.Context, experimentID, variant, pinID string) (api.QualityPromoteResult, error)

type DirectClient struct {
	devtools      *Service
	quality       *quality.Service
	observability *observability.Service
	promote       PromoteFunc
}

func NewDirectClient(s *store.Store, qualityServices ...*quality.Service) *DirectClient {
	var qualitySvc *quality.Service
	if len(qualityServices) > 0 {
		qualitySvc = qualityServices[0]
	}
	return NewDirectClientFromService(NewService(s, qualitySvc))
}

func NewDirectClientFromService(devtools *Service) *DirectClient {
	return &DirectClient{devtools: devtools, quality: devtools.Quality()}
}

func (c *DirectClient) WithObservability(service *observability.Service) *DirectClient {
	c.observability = service
	c.devtools.WithObservability(service)
	return c
}

// WithQualityPromote injects the server-side promotion function.
func (c *DirectClient) WithQualityPromote(fn PromoteFunc) *DirectClient {
	c.promote = fn
	return c
}

// PromoteBaseline runs the injected server-side promotion. Without a wired
// promote function (e.g. headless construction) it reports the limitation.
func (c *DirectClient) PromoteBaseline(ctx context.Context, experimentID, variant, pinID string) (api.QualityPromoteResult, error) {
	if c.promote == nil {
		return api.QualityPromoteResult{}, fmt.Errorf("promotion is unavailable: no quality worker wired")
	}
	return c.promote(ctx, experimentID, variant, pinID)
}

func (c *DirectClient) GetJSON(ctx context.Context, path string, target any) error {
	if strings.HasPrefix(path, "/api/quality/") {
		return c.getQualityJSON(ctx, path, target)
	}
	if strings.HasPrefix(path, "/api/observability/") {
		return c.getObservabilityJSON(ctx, path, target)
	}
	return c.getRegisteredJSON(ctx, path, target)
}

func (c *DirectClient) getRegisteredJSON(ctx context.Context, path string, target any) error {
	mux := http.NewServeMux()
	readmodel.Mount(mux, endpoints.Deps{Devtools: c.devtools, Quality: c.quality}, endpoints.Registry)
	resp := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, path, nil)
	mux.ServeHTTP(resp, req)
	if resp.Code == http.StatusNotFound {
		return fmt.Errorf("unsupported direct API path %q", path)
	}
	if resp.Code < 200 || resp.Code >= 300 {
		return fmt.Errorf("direct API path %q failed with HTTP %d: %s", path, resp.Code, strings.TrimSpace(resp.Body.String()))
	}
	return json.Unmarshal(resp.Body.Bytes(), target)
}

func (c *DirectClient) getObservabilityJSON(ctx context.Context, path string, target any) error {
	if c.observability == nil {
		return fmt.Errorf("observability service not configured")
	}
	route, limit := splitQuery(path)
	// Match the HTTP surface: revisioned page envelope only (no bare array list).
	if route == "/api/observability/runs/page" {
		page, err := c.observability.RunsPage(ctx, observability.RunListOptions{Limit: limit})
		if err != nil {
			return err
		}
		return assignJSON(target, page)
	}
	if family, ok := strings.CutPrefix(path, "/api/observability/resources/"); ok {
		activity, err := c.observability.ResourceActivity(ctx, family)
		if err != nil {
			return err
		}
		return assignJSON(target, activity)
	}
	if runID, ok := strings.CutPrefix(path, "/api/observability/runs/"); ok {
		if graphRunID, ok := strings.CutSuffix(runID, "/graph"); ok {
			graph, err := c.observability.Graph(ctx, graphRunID)
			if err != nil {
				return err
			}
			return assignJSON(target, graph)
		}
		detail, err := c.observability.RunDetail(ctx, runID)
		if err != nil {
			return err
		}
		return assignJSON(target, detail)
	}
	return fmt.Errorf("unsupported direct observability API path %q", path)
}

func (c *DirectClient) getQualityJSON(ctx context.Context, path string, target any) error {
	if c.quality == nil {
		return fmt.Errorf("quality service not configured")
	}
	route, query := splitURL(path)
	deps := endpoints.Deps{Quality: c.quality}

	if traceID, ok := strings.CutPrefix(route, "/api/quality/runs/"); ok {
		record, err := endpoints.QualityRunDetail.Call(ctx, deps, &readmodel.PathID{ID: traceID})
		return assignEndpointJSON(target, record, err)
	}

	// Spec-02 canonical data surface.
	if experimentRoute, ok := strings.CutPrefix(route, "/api/quality/experiments/"); ok {
		if experimentID, ok := strings.CutSuffix(experimentRoute, "/cell-evidence"); ok {
			params := &endpoints.CellEvidenceParams{}
			err := params.Parse(readmodel.Req{
				Query: query,
				PathValue: func(name string) string {
					if name == "experimentId" {
						return experimentID
					}
					return ""
				},
			})
			if err != nil {
				return err
			}
			record, err := endpoints.QualityCellEvidence.Call(ctx, deps, params)
			return assignEndpointJSON(target, record, err)
		}
		record, err := endpoints.QualityExperimentRecord.Call(ctx, deps, &readmodel.PathID{ID: experimentRoute})
		return assignEndpointJSON(target, record, err)
	}
	if evaluationID, ok := strings.CutPrefix(route, "/api/quality/baselines/"); ok {
		record, err := endpoints.QualityBaselineRecord.Call(ctx, deps, &readmodel.PathID{ID: evaluationID})
		return assignEndpointJSON(target, record, err)
	}
	if route == "/api/quality/evaluations/experiment-groups" {
		params := &readmodel.Limit{Default: 20}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		record, err := endpoints.QualityEvaluationExperimentGroups.Call(ctx, deps, params)
		return assignEndpointJSON(target, record, err)
	}
	if evaluationRoute, ok := strings.CutPrefix(route, "/api/quality/evaluations/"); ok {
		if evaluationID, ok := strings.CutSuffix(evaluationRoute, "/progress"); ok {
			params := &endpoints.EvaluationIDLimitParams{}
			err := params.Parse(readmodel.Req{
				Query: query,
				PathValue: func(name string) string {
					if name == "evaluationId" {
						return evaluationID
					}
					return ""
				},
			})
			if err != nil {
				return err
			}
			record, err := endpoints.QualityEvaluationProgress.Call(ctx, deps, params)
			return assignEndpointJSON(target, record, err)
		}
		if evaluationID, ok := strings.CutSuffix(evaluationRoute, "/experiments"); ok {
			params := &endpoints.EvaluationIDLimitParams{}
			err := params.Parse(readmodel.Req{
				Query: query,
				PathValue: func(name string) string {
					if name == "evaluationId" {
						return evaluationID
					}
					return ""
				},
			})
			if err != nil {
				return err
			}
			record, err := endpoints.QualityEvaluationExperiments.Call(ctx, deps, params)
			return assignEndpointJSON(target, record, err)
		}
	}

	switch route {
	case "/api/quality/overview":
		params := &endpoints.QualityOverviewParams{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		record, err := endpoints.QualityWorkbenchOverview.Call(ctx, deps, params)
		return assignEndpointJSON(target, record, err)
	case "/api/quality/experiments":
		params := &endpoints.QualityExperimentsParams{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		records, err := endpoints.QualityExperimentSummaries.Call(ctx, deps, params)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/baselines":
		records, err := endpoints.QualityBaselineRecords.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/cassettes":
		records, err := endpoints.QualityCassetteFiles.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/scorers":
		records, err := endpoints.QualityScorerStats.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/activity":
		params := &readmodel.Limit{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		records, err := endpoints.QualityActivity.Call(ctx, deps, params)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/runs":
		params := &endpoints.RunsParams{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		records, err := endpoints.QualityRuns.Call(ctx, deps, params)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/insights":
		records, err := endpoints.QualityInsights.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/insights/silences":
		params := &endpoints.IncludeDeletedParams{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		records, err := endpoints.QualityInsightSilences.Call(ctx, deps, params)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/feedback":
		records, err := endpoints.QualityFeedback.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/feedback/annotations":
		records, err := endpoints.QualityFeedbackAnnotations.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	case "/api/quality/feedback/memory-proposals":
		records, err := endpoints.QualityMemoryProposals.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	default:
		return fmt.Errorf("unsupported direct quality API path %q", path)
	}
}

func assignEndpointJSON(target any, value any, err error) error {
	if errors.Is(err, readmodel.ErrNotFound) {
		return fmt.Errorf("not found")
	}
	if err != nil {
		return err
	}
	return assignJSON(target, value)
}

func splitURL(path string) (string, url.Values) {
	route, rawQuery, ok := strings.Cut(path, "?")
	if !ok {
		return path, url.Values{}
	}
	query, _ := url.ParseQuery(rawQuery)
	return route, query
}

func assignJSON(target any, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func splitQuery(path string) (string, int) {
	route, query, ok := strings.Cut(path, "?")
	if !ok {
		return path, 0
	}
	limit := 0
	for _, part := range strings.Split(query, "&") {
		key, value, ok := strings.Cut(part, "=")
		if ok && key == "limit" {
			fmt.Sscanf(value, "%d", &limit)
		}
	}
	return route, limit
}
