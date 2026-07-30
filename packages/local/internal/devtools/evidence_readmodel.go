package devtools

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

// InspectEvidence exposes the canonical Local inspector to Devtools without a
// second projection or bounded run-detail rescan.
func (s *Service) InspectEvidence(
	ctx context.Context,
	request observability.EvidenceInspectRequest,
) (observability.EvidenceInspectResult, error) {
	if s.observability == nil {
		return observability.EvidenceInspectResult{},
			errNoObservabilityService
	}
	return s.observability.InspectEvidence(ctx, request)
}

// InspectEvidence exposes the same canonical read model to in-process clients.
func (c *DirectClient) InspectEvidence(
	ctx context.Context,
	request observability.EvidenceInspectRequest,
) (observability.EvidenceInspectResult, error) {
	if c.observability == nil {
		return observability.EvidenceInspectResult{},
			errNoObservabilityService
	}
	return c.observability.InspectEvidence(ctx, request)
}

// SummarizeEvidenceSubjects exposes canonical complete counts to Devtools.
func (s *Service) SummarizeEvidenceSubjects(
	ctx context.Context,
	request observability.EvidenceSubjectSummaryRequest,
) (observability.EvidenceSubjectSummaryResponse, error) {
	if s.observability == nil {
		return observability.EvidenceSubjectSummaryResponse{},
			errNoObservabilityService
	}
	return s.observability.SummarizeEvidenceSubjects(ctx, request)
}

// SummarizeEvidenceSubjects exposes the same read model in-process.
func (c *DirectClient) SummarizeEvidenceSubjects(
	ctx context.Context,
	request observability.EvidenceSubjectSummaryRequest,
) (observability.EvidenceSubjectSummaryResponse, error) {
	if c.observability == nil {
		return observability.EvidenceSubjectSummaryResponse{},
			errNoObservabilityService
	}
	return c.observability.SummarizeEvidenceSubjects(ctx, request)
}

// ResolveEvidenceNavigation exposes exact retained provenance to Devtools.
func (s *Service) ResolveEvidenceNavigation(
	ctx context.Context,
	request observability.EvidenceNavigationRequest,
) (observability.EvidenceNavigationResponse, error) {
	if s.observability == nil {
		return observability.EvidenceNavigationResponse{},
			errNoObservabilityService
	}
	return s.observability.ResolveEvidenceNavigation(ctx, request)
}

// ResolveEvidenceNavigation exposes the same read model in-process.
func (c *DirectClient) ResolveEvidenceNavigation(
	ctx context.Context,
	request observability.EvidenceNavigationRequest,
) (observability.EvidenceNavigationResponse, error) {
	if c.observability == nil {
		return observability.EvidenceNavigationResponse{},
			errNoObservabilityService
	}
	return c.observability.ResolveEvidenceNavigation(ctx, request)
}
