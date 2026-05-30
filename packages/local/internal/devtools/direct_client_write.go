package devtools

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/quality"
)

// Typed write accessors. Each method takes/returns api.Quality* types and
// JSON-roundtrips through the internal quality records. This is the
// in-process mirror of the equivalent `POST /api/quality/...` HTTP routes.

// SetInsightStatus updates an insight's open/dismissed/resolved status.
func (c *DirectClient) SetInsightStatus(ctx context.Context, insightID string, req api.QualityInsightStatusRequest) (api.QualityInsightStatusRecord, error) {
	var out api.QualityInsightStatusRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.InsightStatusRequest
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.SetInsightStatus(ctx, insightID, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// CreateComparison records a baseline vs candidate comparison.
func (c *DirectClient) CreateComparison(ctx context.Context, req api.QualityComparisonPostRequest) (api.QualityComparisonRecord, error) {
	var out api.QualityComparisonRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.ComparisonPostRequest
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.CreateComparison(ctx, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// CreateBaseline promotes an experiment/variant to a pinned baseline.
func (c *DirectClient) CreateBaseline(ctx context.Context, req api.QualityBaselinePostRequest) (api.QualityBaselineRecord, error) {
	var out api.QualityBaselineRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.BaselinePostRequest
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.CreateBaseline(ctx, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// CreateCassetteIssue records a missing/mismatch/recorded entry overlay.
func (c *DirectClient) CreateCassetteIssue(ctx context.Context, req api.QualityCassetteIssueRecord) (api.QualityCassetteIssueRecord, error) {
	var out api.QualityCassetteIssueRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.CassetteIssueRecord
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.CreateCassetteIssue(ctx, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// CreateFeedbackAnnotation appends a review note to a feedback record.
func (c *DirectClient) CreateFeedbackAnnotation(ctx context.Context, req api.QualityFeedbackAnnotationPostRequest) (api.QualityFeedbackAnnotationRecord, error) {
	var out api.QualityFeedbackAnnotationRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.FeedbackAnnotationPostRequest
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.CreateFeedbackAnnotation(ctx, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// SaveSuite upserts a whole suite (PUT semantics on the JSON file).
func (c *DirectClient) SaveSuite(ctx context.Context, req api.QualitySuiteRecord) (api.QualitySuiteRecord, error) {
	var out api.QualitySuiteRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.SuiteRecord
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.SaveSuite(ctx, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// UpsertSuiteCase merges a single case into the named suite.
func (c *DirectClient) UpsertSuiteCase(ctx context.Context, suiteID string, req api.QualitySuiteCase) (api.QualitySuiteRecord, error) {
	var out api.QualitySuiteRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.SuiteCase
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.UpsertSuiteCase(ctx, suiteID, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

// DeleteRuns removes one or more quality run projections and their canonical
// observability records, then publishes the same quality event used by the HTTP
// DELETE route.
func (c *DirectClient) DeleteRuns(ctx context.Context, traceIDs []string) (api.QualityDeleteRunsRecord, error) {
	if c.quality == nil {
		return api.QualityDeleteRunsRecord{}, errNoQualityService
	}
	return c.quality.DeleteRuns(ctx, traceIDs)
}

func (c *DirectClient) InsightSilences(ctx context.Context, includeDeleted bool) ([]api.QualityInsightSilenceRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.InsightSilences(ctx, includeDeleted)
	if err != nil {
		return nil, err
	}
	var out []api.QualityInsightSilenceRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) CreateInsightSilence(ctx context.Context, req api.QualityInsightSilenceRequest) (api.QualityInsightSilenceRecord, error) {
	var out api.QualityInsightSilenceRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	var internal quality.InsightSilenceRequest
	if err := assignJSON(&internal, req); err != nil {
		return out, err
	}
	rec, err := c.quality.CreateInsightSilence(ctx, internal)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

func (c *DirectClient) DeleteInsightSilence(ctx context.Context, silenceID string) (api.QualityInsightSilenceRecord, error) {
	var out api.QualityInsightSilenceRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	rec, err := c.quality.DeleteInsightSilence(ctx, silenceID)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}
