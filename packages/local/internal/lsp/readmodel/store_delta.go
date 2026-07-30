package readmodel

import (
	"reflect"
	"sort"
)

// ApplyDelta applies per-file replacement semantics after enforcing scope
// generation ordering. Diagnostics and source rows preserve explicit empty or
// nil replacements from the WebSocket contract.
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
	current.revision++
	changedFiles := make([]string, 0, 2)
	if delta.SourceChanged {
		changedFiles = append(changedFiles, delta.File)
	}
	if applyDefinitionChanges(current.definitions, delta.Definitions) {
		current.definitionsByFile = definitionLookupsByFile(current.definitions)
		current.sitesByFile, current.sitesByTarget = navigationSiteLookups(
			current.relations,
			current.definitions,
		)
		changedFiles = append(changedFiles, delta.File)
	}
	if delta.Diagnostics != nil {
		replacement := cloneIndexDiagnostics(delta.Diagnostics)
		previous := current.diagnostics[delta.File]
		if len(replacement) == 0 {
			delete(current.diagnostics, delta.File)
		} else {
			current.diagnostics[delta.File] = replacement
		}
		if !reflect.DeepEqual(previous, replacement) &&
			!(len(previous) == 0 && len(replacement) == 0) {
			changedFiles = append(changedFiles, delta.File)
		}
	}
	if delta.SourceChanged {
		if delta.SourceRow == nil {
			delete(current.sources, delta.File)
		} else {
			current.sources[delta.File] = cloneSourceFile(*delta.SourceRow)
		}
	}
	if delta.Lints != nil {
		replacement := cloneFindings(delta.Lints.Findings)
		previous := current.anchors[delta.File]
		if len(replacement) == 0 {
			delete(current.anchors, delta.File)
		} else {
			current.anchors[delta.File] = replacement
		}
		if !reflect.DeepEqual(previous, replacement) &&
			!(len(previous) == 0 && len(replacement) == 0) {
			changedFiles = append(changedFiles, delta.File)
		}
	}
	sort.Strings(changedFiles)
	return DeltaResult{Status: DeltaApplied, ChangedFiles: compactStrings(changedFiles)}
}
