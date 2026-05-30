package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/anthropics/crux-cli/internal/observability"
	"github.com/anthropics/crux-cli/internal/quality"
	"github.com/anthropics/crux-cli/internal/store"
)

var errNoQualityService = fmt.Errorf("quality service not configured")
var errNoObservabilityService = fmt.Errorf("observability service not configured")

// DirectClient exposes the devtools read API against an in-process store.
// It lets native clients use the same logical routes as the HTTP API without a
// loopback HTTP/WebSocket dependency.
type DirectClient struct {
	devtools      *Service
	quality       *quality.Service
	observability *observability.Service
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

func (c *DirectClient) GetJSON(ctx context.Context, path string, target any) error {
	if strings.HasPrefix(path, "/api/quality/") {
		return c.getQualityJSON(ctx, path, target)
	}
	if strings.HasPrefix(path, "/api/observability/") {
		return c.getObservabilityJSON(ctx, path, target)
	}
	value, found, err := c.devtools.Get(ctx, path, nil)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("unsupported direct API path %q", path)
	}
	return assignJSON(target, value)
}

func (c *DirectClient) getObservabilityJSON(ctx context.Context, path string, target any) error {
	if c.observability == nil {
		return fmt.Errorf("observability service not configured")
	}
	if path == "/api/observability/runs" {
		runs, err := c.observability.Runs(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, runs)
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
	if traceID, ok := strings.CutPrefix(path, "/api/quality/runs/"); ok {
		record, found, err := c.quality.RunDetail(ctx, traceID)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("not found")
		}
		return assignJSON(target, record)
	}
	if suiteID, ok := strings.CutPrefix(path, "/api/quality/suites/"); ok {
		record, found, err := c.quality.Suite(ctx, suiteID)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("not found")
		}
		return assignJSON(target, record)
	}
	if experimentID, ok := strings.CutPrefix(path, "/api/quality/experiments/"); ok {
		record, err := c.quality.Experiment(ctx, experimentID)
		if err != nil {
			return err
		}
		return assignJSON(target, record)
	}
	if comparisonID, ok := strings.CutPrefix(path, "/api/quality/comparisons/"); ok {
		record, err := c.quality.Comparison(ctx, comparisonID)
		if err != nil {
			return err
		}
		return assignJSON(target, record)
	}
	if baselineID, ok := strings.CutPrefix(path, "/api/quality/baselines/"); ok {
		record, err := c.quality.Baseline(ctx, baselineID)
		if err != nil {
			return err
		}
		return assignJSON(target, record)
	}

	route, limit := splitQuery(path)
	switch route {
	case "/api/quality/overview":
		record, err := c.quality.Overview(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, record)
	case "/api/quality/activity":
		records, err := c.quality.RecentActivity(ctx, limit)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/runs":
		records, err := c.quality.Runs(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/suites":
		records, err := c.quality.Suites(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/insights":
		records, err := c.quality.Insights(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/insights/silences":
		records, err := c.quality.InsightSilences(ctx, strings.Contains(path, "include=deleted"))
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/experiments":
		records, err := c.quality.Experiments(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/comparisons":
		records, err := c.quality.Comparisons(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/baselines":
		records, err := c.quality.Baselines(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/cassettes":
		records, err := c.quality.Cassettes(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/feedback":
		records, err := c.quality.Feedback(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/feedback/annotations":
		records, err := c.quality.FeedbackAnnotations(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/feedback/memory-proposals":
		records, err := c.quality.MemoryProposals(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	case "/api/quality/scorers":
		records, err := c.quality.Scorers(ctx)
		if err != nil {
			return err
		}
		return assignJSON(target, records)
	default:
		return fmt.Errorf("unsupported direct quality API path %q", path)
	}
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
