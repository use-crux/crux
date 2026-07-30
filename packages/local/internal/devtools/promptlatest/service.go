package promptlatest

import "context"

const maxResolveAttempts = 3

// Service coordinates current Project Index ownership, one authoritative
// observability snapshot, and the optional private exact-preview availability
// bit without publishing intermediate selections.
type Service struct {
	index        indexPort
	runs         runsPort
	availability availabilityPort
}

func New(index indexPort, runs runsPort, availability availabilityPort) *Service {
	return &Service{index: index, runs: runs, availability: availability}
}

// Resolve selects the latest operation for a current canonical Prompt owner.
// A concurrent Project Index replacement retries the complete operation up to
// three total attempts.
func (s *Service) Resolve(ctx context.Context, definitionID string) (Result, error) {
	for attempt := 0; attempt < maxResolveAttempts; attempt++ {
		before := s.index.CaptureProjectIndex()
		if reason := currentPromptOwner(before, definitionID); reason != "" {
			return unavailableResult(reason), nil
		}

		snapshot, err := s.runs.LatestOperationForDefinition(ctx, definitionID)
		if err != nil {
			return Result{}, err
		}
		available := false
		if snapshot.OperationID == "" {
			available = s.availability.HasPromptPreviewTarget(definitionID)
		}

		after := s.index.CaptureProjectIndex()
		if after.Generation != before.Generation ||
			currentPromptOwner(after, definitionID) != "" {
			continue
		}
		if snapshot.OperationID != "" {
			return Result{
				Status: StatusFound, DefinitionID: definitionID,
				ObservabilityRevision: snapshot.Revision,
				OperationID:           snapshot.OperationID,
			}, nil
		}
		return Result{
			Status: StatusEmpty, DefinitionID: definitionID,
			ObservabilityRevision: snapshot.Revision,
			ExactPreviewAvailable: available,
		}, nil
	}
	return Result{}, ErrTemporarilyUnavailable
}

func unavailableResult(reason UnavailableReason) Result {
	return Result{Status: StatusUnavailable, UnavailableReason: reason}
}
