package projectindex

import "github.com/use-crux/crux/packages/local/internal/store"

// State owns the in-memory Project Index patch projection for one local service.
//
// It deliberately does not lock. The service decides its critical sections,
// while State keeps patch application, phase diagnostics, and generation
// accounting in one place.
type State struct {
	patch      PatchState
	generation Generation
}

func NewState() *State {
	return &State{patch: EmptyPatchState()}
}

func (s *State) Reset() {
	if s == nil {
		return
	}
	s.patch = EmptyPatchState()
}

func (s *State) Index() store.IndexData {
	if s == nil {
		return store.IndexData{}
	}
	return s.patch.Index
}

func (s *State) Apply(patch IndexPatch) store.IndexData {
	if s == nil {
		return store.IndexData{}
	}
	if patch.Phase == PhaseAST {
		s.generation.BumpAST()
	}
	s.patch = ApplyPatch(s.patch, patch)
	return s.patch.Index
}

func (s *State) Hydrate(index store.IndexData, phase IndexPatchPhase, status string) {
	if s == nil {
		return
	}
	s.patch = ApplyPatch(EmptyPatchState(), PatchFromSnapshot(index, phase, status))
}

func (s *State) CurrentGeneration() uint64 {
	if s == nil {
		return 0
	}
	return s.generation.Current()
}

func (s *State) IsCurrent(generation uint64) bool {
	if s == nil {
		return generation == 0
	}
	return s.generation.IsCurrent(generation)
}

func (s *State) PhaseDiagnostics(phase IndexPatchPhase) []store.IndexDiagnostic {
	if s == nil {
		return nil
	}
	return append([]store.IndexDiagnostic(nil), s.patch.DiagnosticsByPhase[phase]...)
}

func (s *State) SetPhaseDiagnostics(phase IndexPatchPhase, diagnostics []store.IndexDiagnostic) {
	if s == nil {
		return
	}
	s.patch.DiagnosticsByPhase[phase] = append([]store.IndexDiagnostic(nil), diagnostics...)
}
