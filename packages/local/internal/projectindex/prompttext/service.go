package prompttext

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex/sourcehash"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// Service runs PromptText analysis through an already-owned persistent
// compiler. It neither owns worker lifecycle nor retains document text.
type Service struct {
	compiler Compiler
}

// New creates a transient service over an existing compiler capability.
func New(compiler Compiler) *Service {
	return &Service{compiler: compiler}
}

// Analyze classifies one exact document revision and verifies the echoed
// identity before returning normalized evidence.
func (s *Service) Analyze(ctx context.Context, request Request) (Result, error) {
	if s == nil || s.compiler == nil {
		return Result{}, fmt.Errorf("PromptText compiler is unavailable")
	}
	limits := DefaultLimits()
	if len(request.Text) > int(limits.MaxSourceBytes) {
		return Result{}, fmt.Errorf("PromptText document exceeds %d bytes", limits.MaxSourceBytes)
	}
	if request.Revision.SourceHash != sourcehash.Sum([]byte(request.Text)) {
		return Result{}, fmt.Errorf("PromptText source hash does not match document bytes")
	}
	query := staticprotocol.PromptTextQuery{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File,
		LanguageID:      request.LanguageID,
		Revision:        request.Revision,
		Source:          request.Text,
		Fragments:       initialFragments(),
		Limits:          limits,
	}
	response, err := s.compiler.PromptText(ctx, query)
	if err != nil {
		return Result{}, err
	}
	if response.ProtocolVersion != staticprotocol.PromptTextProtocolVersion ||
		response.File != request.File ||
		response.Revision != request.Revision {
		return Result{}, fmt.Errorf("PromptText compiler returned mismatched request identity")
	}
	return response, nil
}
