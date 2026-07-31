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
	seen := map[string]bool{}
	for _, definition := range source {
		group := s.definitionGroup(definition)
		if !seen[group] {
			seen[group] = true
			groups = append(groups, group)
		}
	}
	definitions := make([]api.ProjectDefinition, 0, len(source))
	for _, group := range groups {
		for _, definition := range source {
			if s.definitionGroup(definition) == group {
				definitions = append(definitions, definition)
			}
		}
	}
	return definitions
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
	definitions := s.groupedDefinitions()
	for index, candidate := range definitions {
		if candidate.ID != definition.ID {
			continue
		}
		if index == 0 || s.definitionGroup(definitions[index-1]) != s.definitionGroup(candidate) {
			return 2
		}
		break
	}
	return 1
}

func (s *Index) groupCount(group string) int {
	count := 0
	for _, definition := range s.indexData().Definitions {
		if s.definitionGroup(definition) == group {
			count++
		}
	}
	return count
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
	s.definitions.SetItems(s.groupedDefinitions())
	s.definitions.Select(selected)
	s.syncDetail()
}
