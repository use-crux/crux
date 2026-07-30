package api

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

// InspectEvidence reads Local's canonical bounded evidence model.
//
// The method intentionally delegates to the same HTTP endpoint used by Core
// and Devtools so agent-facing callers cannot drift onto a second projection.
func (c *Client) InspectEvidence(
	ctx context.Context,
	request observability.EvidenceInspectRequest,
) (observability.EvidenceInspectResult, error) {
	var result observability.EvidenceInspectResult
	err := c.PostJSON(
		ctx,
		"/api/observability/evidence/inspect",
		request,
		&result,
	)
	return result, err
}

// SummarizeEvidenceSubjects reads the same complete counts used by Devtools.
func (c *Client) SummarizeEvidenceSubjects(
	ctx context.Context,
	request observability.EvidenceSubjectSummaryRequest,
) (observability.EvidenceSubjectSummaryResponse, error) {
	var result observability.EvidenceSubjectSummaryResponse
	err := c.PostJSON(
		ctx,
		"/api/observability/evidence/subjects/summary",
		request,
		&result,
	)
	return result, err
}

// ResolveEvidenceNavigation reads historical provenance without a Catalog join.
func (c *Client) ResolveEvidenceNavigation(
	ctx context.Context,
	request observability.EvidenceNavigationRequest,
) (observability.EvidenceNavigationResponse, error) {
	var result observability.EvidenceNavigationResponse
	err := c.PostJSON(
		ctx,
		"/api/observability/evidence/navigation/resolve",
		request,
		&result,
	)
	return result, err
}
