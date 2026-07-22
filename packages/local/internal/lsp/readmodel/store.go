// Package readmodel owns the LSP process's per-scope lint finding view.
package readmodel

import (
	"reflect"
	"sort"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Snapshot is the lint subset of a full Project Index snapshot. A nil
// Generation identifies a pre-Phase-1 server whose first delta establishes the
// generation baseline.
type Snapshot struct {
	ProjectRoot   string
	ServerVersion string
	Generation    *uint64
	Findings      []api.IndexLintFinding
	Definitions   []api.ProjectDefinition
	Sources       []api.IndexSourceFile
}

// DefinitionChanges is the definition subset of an index:delta message.
type DefinitionChanges struct {
	Added      []api.ProjectDefinition `json:"added"`
	Changed    []api.ProjectDefinition `json:"changed"`
	RemovedIDs []string                `json:"removedIds"`
}

// LintReplacement is the complete finding set for one anchor file.
type LintReplacement struct {
	Findings []api.IndexLintFinding `json:"findings"`
}

// Delta is the LSP-owned subset of an index:delta message. A nil Lints value
// means the delta changed other Project Index sections but did not change
// lints. SourceChanged invalidates source text derived mapping state.
type Delta struct {
	Generation    uint64
	File          string
	Lints         *LintReplacement
	Definitions   DefinitionChanges
	SourceChanged bool
}

// DeltaStatus describes whether a delta mutated the store or requires an HTTP
// snapshot before processing can continue.
type DeltaStatus uint8

const (
	// DeltaApplied means the generation was accepted. ChangedFiles may be empty.
	DeltaApplied DeltaStatus = iota
	// DeltaIgnored means the delta predates the current snapshot.
	DeltaIgnored
	// DeltaNeedsResync means no snapshot exists or a generation gap was found.
	DeltaNeedsResync
)

// DeltaResult reports reduction status and the anchors whose replacement sets
// changed. ChangedFiles is deterministically sorted.
type DeltaResult struct {
	Status       DeltaStatus
	ChangedFiles []string
}

type scopeState struct {
	anchors         map[string][]api.IndexLintFinding
	definitions     map[string]api.ProjectDefinition
	sources         map[string]api.IndexSourceFile
	initialized     bool
	generation      uint64
	generationKnown bool
}

// Store is a concurrency-safe collection of independent workspace scopes.
type Store struct {
	mu     sync.RWMutex
	scopes map[string]*scopeState
}

// NewStore creates an empty per-scope finding store.
func NewStore() *Store {
	return &Store{scopes: make(map[string]*scopeState)}
}

// ApplySnapshot atomically replaces one scope and returns every changed anchor.
func (s *Store) ApplySnapshot(scope string, snapshot Snapshot) []string {
	next := findingsByAnchor(snapshot.Findings)
	nextDefinitions := definitionsByID(snapshot.Definitions)
	nextSources := sourcesByFile(snapshot.Sources)

	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.scope(scope)
	changed := changedAnchors(current.anchors, next)
	changed = append(changed, definitionAffectedAnchors(current, next, nextDefinitions)...)
	changed = append(changed, changedSources(current.sources, nextSources)...)
	sort.Strings(changed)
	changed = compactStrings(changed)
	current.anchors = next
	current.definitions = nextDefinitions
	current.sources = nextSources
	current.initialized = true
	current.generationKnown = snapshot.Generation != nil
	if snapshot.Generation != nil {
		current.generation = *snapshot.Generation
	} else {
		current.generation = 0
	}
	return changed
}

// ApplyDelta applies replacement semantics after enforcing per-scope
// generation ordering.
func (s *Store) ApplyDelta(scope string, delta Delta) DeltaResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.scope(scope)
	if !current.initialized {
		return DeltaResult{Status: DeltaNeedsResync}
	}
	if current.generationKnown {
		if delta.Generation < current.generation {
			return DeltaResult{Status: DeltaIgnored}
		}
		if delta.Generation > current.generation+1 {
			return DeltaResult{Status: DeltaNeedsResync}
		}
	} else {
		current.generationKnown = true
	}
	current.generation = delta.Generation
	changedFiles := make([]string, 0, 2)
	if delta.SourceChanged {
		changedFiles = append(changedFiles, delta.File)
	}
	if applyDefinitionChanges(current.definitions, delta.Definitions) {
		changedFiles = append(changedFiles, delta.File)
	}

	if delta.Lints == nil {
		sort.Strings(changedFiles)
		return DeltaResult{Status: DeltaApplied, ChangedFiles: compactStrings(changedFiles)}
	}
	replacement := cloneFindings(delta.Lints.Findings)
	previous := current.anchors[delta.File]
	if len(replacement) == 0 {
		delete(current.anchors, delta.File)
	} else {
		current.anchors[delta.File] = replacement
	}
	if reflect.DeepEqual(previous, replacement) || (len(previous) == 0 && len(replacement) == 0) {
		sort.Strings(changedFiles)
		return DeltaResult{Status: DeltaApplied, ChangedFiles: compactStrings(changedFiles)}
	}
	changedFiles = append(changedFiles, delta.File)
	sort.Strings(changedFiles)
	return DeltaResult{Status: DeltaApplied, ChangedFiles: compactStrings(changedFiles)}
}

// Findings returns a detached copy of one anchor's findings.
func (s *Store) Findings(scope, file string) []api.IndexLintFinding {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return nil
	}
	return cloneFindings(current.anchors[file])
}

// AllFindings returns detached copies of every anchor in one scope.
func (s *Store) AllFindings(scope string) map[string][]api.IndexLintFinding {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string][]api.IndexLintFinding)
	if current := s.scopes[scope]; current != nil {
		for file, findings := range current.anchors {
			result[file] = cloneFindings(findings)
		}
	}
	return result
}

// Finding returns a detached finding from one scope by its stable identity.
func (s *Store) Finding(scope, id string) (api.IndexLintFinding, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return api.IndexLintFinding{}, false
	}
	for _, findings := range current.anchors {
		for _, finding := range findings {
			if finding.ID == id {
				return cloneFindings([]api.IndexLintFinding{finding})[0], true
			}
		}
	}
	return api.IndexLintFinding{}, false
}

// Definition returns a detached definition used to refine one finding range.
func (s *Store) Definition(scope, id string) (api.ProjectDefinition, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return api.ProjectDefinition{}, false
	}
	definition, ok := current.definitions[id]
	return cloneDefinition(definition), ok
}

func (s *Store) scope(id string) *scopeState {
	current := s.scopes[id]
	if current == nil {
		current = &scopeState{
			anchors:     make(map[string][]api.IndexLintFinding),
			definitions: make(map[string]api.ProjectDefinition),
			sources:     make(map[string]api.IndexSourceFile),
		}
		s.scopes[id] = current
	}
	return current
}

func findingsByAnchor(findings []api.IndexLintFinding) map[string][]api.IndexLintFinding {
	result := make(map[string][]api.IndexLintFinding)
	for _, finding := range cloneFindings(findings) {
		file := ""
		if finding.Source != nil {
			file = finding.Source.File
		}
		result[file] = append(result[file], finding)
	}
	return result
}

func changedAnchors(previous, current map[string][]api.IndexLintFinding) []string {
	changed := make(map[string]struct{})
	for file, findings := range previous {
		if !reflect.DeepEqual(findings, current[file]) {
			changed[file] = struct{}{}
		}
	}
	for file, findings := range current {
		if !reflect.DeepEqual(findings, previous[file]) {
			changed[file] = struct{}{}
		}
	}
	result := make([]string, 0, len(changed))
	for file := range changed {
		result = append(result, file)
	}
	sort.Strings(result)
	return result
}
