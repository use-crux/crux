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

	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/store"
)

var errNoInspectService = fmt.Errorf("Inspect service not configured")
var errNoObservabilityService = fmt.Errorf("observability service not configured")

// DirectClient exposes the devtools read API against an in-process store.
// It lets native clients use the same logical routes as the HTTP API without a
// loopback HTTP/WebSocket dependency.
type DirectClient struct {
	devtools      *Service
	inspect       *inspect.Service
	observability *observability.Service
}

func NewDirectClient(s *store.Store, inspectServices ...*inspect.Service) *DirectClient {
	var inspectSvc *inspect.Service
	if len(inspectServices) > 0 {
		inspectSvc = inspectServices[0]
	}
	return NewDirectClientFromService(NewService(s, inspectSvc))
}

func NewDirectClientFromService(devtools *Service) *DirectClient {
	return &DirectClient{devtools: devtools, inspect: devtools.Inspect()}
}

func (c *DirectClient) WithObservability(service *observability.Service) *DirectClient {
	c.observability = service
	c.devtools.WithObservability(service)
	return c
}

func (c *DirectClient) GetJSON(ctx context.Context, path string, target any) error {
	if strings.HasPrefix(path, "/api/inspect/") {
		return c.getInspectJSON(ctx, path, target)
	}
	if strings.HasPrefix(path, "/api/observability/") {
		return c.getObservabilityJSON(ctx, path, target)
	}
	return c.getRegisteredJSON(ctx, path, target)
}

func (c *DirectClient) getRegisteredJSON(ctx context.Context, path string, target any) error {
	mux := http.NewServeMux()
	readmodel.Mount(mux, endpoints.Deps{Devtools: c.devtools, Inspect: c.inspect}, endpoints.Registry)
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

func (c *DirectClient) getInspectJSON(ctx context.Context, path string, target any) error {
	if c.inspect == nil {
		return fmt.Errorf("Inspect service not configured")
	}
	route, query := splitURL(path)
	deps := endpoints.Deps{Inspect: c.inspect}

	if traceID, ok := strings.CutPrefix(route, "/api/inspect/runs/"); ok {
		record, err := endpoints.InspectRunDetail.Call(ctx, deps, &readmodel.PathID{ID: traceID})
		return assignEndpointJSON(target, record, err)
	}

	switch route {
	case "/api/inspect/overview":
		params := &endpoints.InspectOverviewParams{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		record, err := endpoints.InspectOverview.Call(ctx, deps, params)
		return assignEndpointJSON(target, record, err)
	case "/api/inspect/activity":
		params := &readmodel.Limit{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		records, err := endpoints.InspectActivity.Call(ctx, deps, params)
		return assignEndpointJSON(target, records, err)
	case "/api/inspect/runs":
		params := &endpoints.RunsParams{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		records, err := endpoints.InspectRuns.Call(ctx, deps, params)
		return assignEndpointJSON(target, records, err)
	case "/api/inspect/insights":
		records, err := endpoints.InspectInsights.Call(ctx, deps)
		return assignEndpointJSON(target, records, err)
	case "/api/inspect/insights/silences":
		params := &endpoints.IncludeDeletedParams{}
		if err := params.Parse(readmodel.Req{Query: query}); err != nil {
			return err
		}
		records, err := endpoints.InspectInsightSilences.Call(ctx, deps, params)
		return assignEndpointJSON(target, records, err)
	default:
		return fmt.Errorf("unsupported direct Inspect API path %q", path)
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
