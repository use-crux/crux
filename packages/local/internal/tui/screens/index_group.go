package screens

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type indexGroupAxis uint8

const (
	indexGroupKind indexGroupAxis = iota
	indexGroupFile
)

func (s *Index) groupedDefinitions() []api.ProjectDefinition {
	source := s.indexData().Definitions
	groups := make([]string, 0)
	definitionsByGroup := make(map[string][]api.ProjectDefinition)
	for _, definition := range source {
		group := s.definitionGroup(definition)
		if _, seen := definitionsByGroup[group]; !seen {
			groups = append(groups, group)
		}
		definitionsByGroup[group] = append(definitionsByGroup[group], definition)
	}
	definitions := make([]api.ProjectDefinition, 0, len(source))
	for _, group := range groups {
		definitions = append(definitions, definitionsByGroup[group]...)
	}
	return definitions
}

func (s *Index) setGroupedDefinitions() {
	definitions := s.groupedDefinitions()
	s.groupStartIDs = make(map[string]bool, len(definitions))
	s.groupCounts = make(map[string]int)
	for index, definition := range definitions {
		s.groupCounts[s.definitionGroup(definition)]++
		if index == 0 || s.definitionGroup(definitions[index-1]) != s.definitionGroup(definition) {
			s.groupStartIDs[definition.ID] = true
		}
	}
	s.cacheLintCounts()
	s.definitions.SetItems(definitions)
}

func (s *Index) definitionGroup(definition api.ProjectDefinition) string {
	if s.groupAxis == indexGroupFile {
		if definition.Source == nil || definition.Source.File == "" {
			return "other"
		}
		projectRoot := s.indexData().ProjectRoot
		if projectRoot == "" && s.indexData().Project != nil {
			projectRoot = s.indexData().Project.Root
		}
		path := projectRelativeIndexPath(projectRoot, definition.Source.File)
		if path == "" {
			return "other"
		}
		return filepath.ToSlash(path)
	}
	if definition.Kind == "" {
		return "other"
	}
	return definition.Kind
}

func (s *Index) definitionRowHeight(definition api.ProjectDefinition) int {
	if s.groupStartIDs[definition.ID] {
		return 2
	}
	return 1
}

func (s *Index) groupCount(group string) int {
	return s.groupCounts[group]
}

func (s *Index) groupAxisLabel() string {
	if s.groupAxis == indexGroupFile {
		return "file"
	}
	return "kind"
}

func (s *Index) nextGroupAxisLabel() string {
	if s.groupAxis == indexGroupKind {
		return "file"
	}
	return "kind"
}

func (s *Index) toggleGroupAxis() {
	selected := s.SelectedDefinitionID()
	if s.groupAxis == indexGroupKind {
		s.groupAxis = indexGroupFile
	} else {
		s.groupAxis = indexGroupKind
	}
	s.setGroupedDefinitions()
	s.definitions.Select(selected)
}
