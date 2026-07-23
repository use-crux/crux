package completion

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// View is the coherent, detached Project Index state used by one query.
type View struct {
	ProjectRoot string
	Generation  uint64
	Definitions []api.ProjectDefinition
}

// Service runs transient completion queries through an existing Static Index
// compiler. It never owns a worker, persists source, or mutates index state.
type Service struct {
	compiler Compiler
}

// New creates a transient completion service over an already-owned compiler.
func New(compiler Compiler) *Service {
	return &Service{compiler: compiler}
}

// Complete compiles one unsaved document against one coherent Project Index
// view and returns the exact document/generation identity of that query.
func (s *Service) Complete(ctx context.Context, view View, request Request) (Result, error) {
	if s == nil || s.compiler == nil {
		return Result{}, fmt.Errorf("project completion compiler is unavailable")
	}
	if len(request.Text) > MaxDocumentBytes {
		return Result{}, fmt.Errorf("project completion document exceeds %d bytes", MaxDocumentBytes)
	}
	limit := request.Limit
	if limit <= 0 || limit > MaxItems {
		limit = MaxItems
	}
	response, err := s.compiler.Completion(ctx, staticprotocol.CompletionQuery{
		File:       request.File,
		LanguageID: request.LanguageID,
		Source:     request.Text,
		Position:   request.Position,
		Candidates: candidates(view, request.File),
		Limit:      limit,
	})
	if err != nil {
		return Result{}, err
	}
	return Result{
		DocumentVersion: request.DocumentVersion,
		Generation:      view.Generation,
		IsIncomplete:    response.IsIncomplete,
		Items:           response.Items,
	}, nil
}
