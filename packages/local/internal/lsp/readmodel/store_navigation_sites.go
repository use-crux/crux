package readmodel

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// NavigationSite identifies an authored source location that targets a
// Project Index definition. ID retains the stable relation or source-ref ID,
// Role is populated for source refs, and Source is detached from Store state.
type NavigationSite struct {
	ID                 string
	TargetDefinitionID string
	Role               string
	Source             api.SourceLoc
}

// ReferencesTo returns detached navigation sites targeting one definition.
func (s *Store) ReferencesTo(scope, definitionID string) []NavigationSite {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return nil
	}
	return cloneNavigationSites(current.sitesByTarget[definitionID])
}

// SitesInFile returns detached navigation sites authored in one file.
func (s *Store) SitesInFile(scope, file string) []NavigationSite {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return nil
	}
	return cloneNavigationSites(current.sitesByFile[file])
}

func navigationSiteLookups(
	relations []api.ProjectRelation,
	definitions map[string]api.ProjectDefinition,
) (map[string][]NavigationSite, map[string][]NavigationSite) {
	byFile := make(map[string][]NavigationSite)
	byTarget := make(map[string][]NavigationSite)
	add := func(site NavigationSite) {
		byFile[site.Source.File] = append(byFile[site.Source.File], site)
		byTarget[site.TargetDefinitionID] = append(byTarget[site.TargetDefinitionID], site)
	}
	for _, relation := range relations {
		if relation.Source == nil || !usableNavigationSource(*relation.Source) {
			continue
		}
		add(NavigationSite{
			ID: relation.ID, TargetDefinitionID: relation.To, Source: cloneNavigationSource(*relation.Source),
		})
	}
	for definitionID, definition := range definitions {
		for _, ref := range definition.SourceRefs {
			if !usableNavigationSource(ref.Source) {
				continue
			}
			add(NavigationSite{
				ID: ref.ID, TargetDefinitionID: definitionID, Role: ref.Role, Source: cloneNavigationSource(ref.Source),
			})
		}
	}
	for _, sites := range byFile {
		sortNavigationSites(sites)
	}
	for _, sites := range byTarget {
		sortNavigationSites(sites)
	}
	return byFile, byTarget
}

func usableNavigationSource(source api.SourceLoc) bool {
	return source.File != "" && source.Line > 0 && (source.Column == nil || *source.Column > 0)
}

func cloneNavigationSites(sites []NavigationSite) []NavigationSite {
	if sites == nil {
		return nil
	}
	result := make([]NavigationSite, len(sites))
	for index, site := range sites {
		result[index] = site
		result[index].Source = cloneNavigationSource(site.Source)
	}
	return result
}

func cloneNavigationSource(source api.SourceLoc) api.SourceLoc {
	return *cloneSource(&source)
}

func sortNavigationSites(sites []NavigationSite) {
	sort.Slice(sites, func(left, right int) bool {
		leftSite, rightSite := sites[left], sites[right]
		leftColumn, rightColumn := 0, 0
		if leftSite.Source.Column != nil {
			leftColumn = *leftSite.Source.Column
		}
		if rightSite.Source.Column != nil {
			rightColumn = *rightSite.Source.Column
		}
		switch {
		case leftSite.Source.File != rightSite.Source.File:
			return leftSite.Source.File < rightSite.Source.File
		case leftSite.Source.Line != rightSite.Source.Line:
			return leftSite.Source.Line < rightSite.Source.Line
		case leftColumn != rightColumn:
			return leftColumn < rightColumn
		case leftSite.ID != rightSite.ID:
			return leftSite.ID < rightSite.ID
		case leftSite.TargetDefinitionID != rightSite.TargetDefinitionID:
			return leftSite.TargetDefinitionID < rightSite.TargetDefinitionID
		case leftSite.Role != rightSite.Role:
			return leftSite.Role < rightSite.Role
		default:
			return leftSite.Source.Function < rightSite.Source.Function
		}
	})
}
