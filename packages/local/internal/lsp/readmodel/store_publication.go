package readmodel

import "github.com/use-crux/crux/packages/local/internal/api"

// Publication is a detached, generation-coherent Store view used to derive
// one complete LSP publication without rereading mutable scope state.
type Publication struct {
	Generation        uint64
	GenerationKnown   bool
	Revision          uint64
	Indexing          *api.ProjectIndexingStatus
	Diagnostics       map[string][]api.IndexDiagnostic
	Findings          map[string][]api.IndexLintFinding
	DefinitionsByID   map[string]api.ProjectDefinition
	DefinitionsByFile map[string][]api.ProjectDefinition
	Relations         []api.ProjectRelation
	SitesByFile       map[string][]NavigationSite
	SourcesByFile     map[string]api.IndexSourceFile
}

// PublicationSnapshot captures one scope's complete publication inputs under
// a single read lock.
func (s *Store) PublicationSnapshot(scope string) Publication {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := Publication{
		Findings:          make(map[string][]api.IndexLintFinding),
		Diagnostics:       make(map[string][]api.IndexDiagnostic),
		DefinitionsByID:   make(map[string]api.ProjectDefinition),
		DefinitionsByFile: make(map[string][]api.ProjectDefinition),
		SitesByFile:       make(map[string][]NavigationSite),
		SourcesByFile:     make(map[string]api.IndexSourceFile),
	}
	current := s.scopes[scope]
	if current == nil {
		return result
	}
	result.Generation = current.generation
	result.GenerationKnown = current.generationKnown
	result.Revision = current.revision
	result.Indexing = cloneIndexingStatus(current.indexing)
	result.Relations = cloneRelations(current.relations)
	for file, findings := range current.anchors {
		result.Findings[file] = cloneFindings(findings)
	}
	for file, diagnostics := range current.diagnostics {
		result.Diagnostics[file] = cloneIndexDiagnostics(diagnostics)
	}
	for id, definition := range current.definitions {
		result.DefinitionsByID[id] = cloneDefinition(definition)
	}
	for file, definitions := range current.definitionsByFile {
		result.DefinitionsByFile[file] = cloneDefinitions(definitions)
	}
	for file, sites := range current.sitesByFile {
		result.SitesByFile[file] = cloneNavigationSites(sites)
	}
	for file, source := range current.sources {
		result.SourcesByFile[file] = cloneSourceFile(source)
	}
	return result
}
