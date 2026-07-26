// Package readmodel owns the LSP process's per-scope Project Index view.
package readmodel

import (
	"reflect"
	"sort"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Snapshot is the LSP-owned subset of a full Project Index snapshot. A nil
// Generation identifies a pre-Phase-1 server whose first delta establishes the
// generation baseline.
type Snapshot struct {
	ProjectRoot   string
	ServerVersion string
	Generation    *uint64
	Indexing      *api.ProjectIndexingStatus
	Diagnostics   []api.IndexDiagnostic
	Findings      []api.IndexLintFinding
	Definitions   []api.ProjectDefinition
	Relations     []api.ProjectRelation
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

// Delta is the LSP-owned subset of an index:delta message. Nil Lints or
// Diagnostics values mean those replacement fields were omitted.
// SourceChanged distinguishes an omitted sourceRow from an explicit null
// removal; SourceRow retains the replacement value when present.
type Delta struct {
	Generation    uint64
	File          string
	Lints         *LintReplacement
	Definitions   DefinitionChanges
	Diagnostics   []api.IndexDiagnostic
	SourceRow     *api.IndexSourceFile
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
	anchors           map[string][]api.IndexLintFinding
	diagnostics       map[string][]api.IndexDiagnostic
	definitions       map[string]api.ProjectDefinition
	definitionsByFile map[string][]api.ProjectDefinition
	sitesByFile       map[string][]NavigationSite
	sitesByTarget     map[string][]NavigationSite
	relations         []api.ProjectRelation
	relationsByTo     map[string][]api.ProjectRelation
	relationsByFile   map[string][]api.ProjectRelation
	sources           map[string]api.IndexSourceFile
	indexing          *api.ProjectIndexingStatus
	initialized       bool
	generation        uint64
	generationKnown   bool
	revision          uint64
}

// Store is a concurrency-safe collection of independent workspace scopes.
type Store struct {
	mu     sync.RWMutex
	scopes map[string]*scopeState
}

// NewStore creates an empty per-scope Project Index store.
func NewStore() *Store {
	return &Store{scopes: make(map[string]*scopeState)}
}

// ApplySnapshot atomically replaces one scope and returns every changed anchor.
func (s *Store) ApplySnapshot(scope string, snapshot Snapshot) []string {
	next := findingsByAnchor(snapshot.Findings)
	nextDiagnostics := diagnosticsBySource(snapshot.Diagnostics)
	nextDefinitions := definitionsByID(snapshot.Definitions)
	nextDefinitionsByFile := definitionLookupsByFile(nextDefinitions)
	nextRelations, nextRelationsByTo, nextRelationsByFile := relationLookups(snapshot.Relations)
	nextSitesByFile, nextSitesByTarget := navigationSiteLookups(nextRelations, nextDefinitions)
	nextSources := sourcesByFile(snapshot.Sources)

	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.scope(scope)
	current.revision++
	changed := changedAnchors(current.anchors, next)
	changed = append(changed, changedIndexFiles(current.diagnostics, nextDiagnostics)...)
	changed = append(changed, definitionAffectedAnchors(current, next, nextDefinitions)...)
	changed = append(changed, changedIndexFiles(current.definitionsByFile, nextDefinitionsByFile)...)
	changed = append(changed, changedIndexFiles(current.sitesByFile, nextSitesByFile)...)
	changed = append(changed, changedRelationFiles(current.relationsByFile, nextRelationsByFile)...)
	changed = append(changed, changedSources(current.sources, nextSources)...)
	sort.Strings(changed)
	changed = compactStrings(changed)
	current.anchors = next
	current.diagnostics = nextDiagnostics
	current.definitions = nextDefinitions
	current.definitionsByFile = nextDefinitionsByFile
	current.sitesByFile = nextSitesByFile
	current.sitesByTarget = nextSitesByTarget
	current.relations = nextRelations
	current.relationsByTo = nextRelationsByTo
	current.relationsByFile = nextRelationsByFile
	current.sources = nextSources
	current.indexing = cloneIndexingStatus(snapshot.Indexing)
	current.initialized = true
	current.generationKnown = snapshot.Generation != nil
	if snapshot.Generation != nil {
		current.generation = *snapshot.Generation
	} else {
		current.generation = 0
	}
	return changed
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
			anchors:           make(map[string][]api.IndexLintFinding),
			diagnostics:       make(map[string][]api.IndexDiagnostic),
			definitions:       make(map[string]api.ProjectDefinition),
			definitionsByFile: make(map[string][]api.ProjectDefinition),
			sitesByFile:       make(map[string][]NavigationSite),
			sitesByTarget:     make(map[string][]NavigationSite),
			relationsByTo:     make(map[string][]api.ProjectRelation),
			relationsByFile:   make(map[string][]api.ProjectRelation),
			sources:           make(map[string]api.IndexSourceFile),
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
