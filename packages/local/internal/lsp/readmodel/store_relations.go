package readmodel

import (
	"reflect"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Relations returns every relation retained for a scope.
func (s *Store) Relations(scope string) []api.ProjectRelation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return nil
	}
	return cloneRelations(current.relations)
}

// RelationsTo returns relations whose target is targetID.
func (s *Store) RelationsTo(scope, targetID string) []api.ProjectRelation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return nil
	}
	return cloneRelations(current.relationsByTo[targetID])
}

// RelationsInFile returns relations whose source location belongs to file.
// Relations without a source location are omitted.
func (s *Store) RelationsInFile(scope, file string) []api.ProjectRelation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.scopes[scope]
	if current == nil {
		return nil
	}
	return cloneRelations(current.relationsByFile[file])
}

func relationLookups(relations []api.ProjectRelation) (
	[]api.ProjectRelation,
	map[string][]api.ProjectRelation,
	map[string][]api.ProjectRelation,
) {
	all := cloneRelations(relations)
	sortRelations(all)
	byTo := make(map[string][]api.ProjectRelation)
	byFile := make(map[string][]api.ProjectRelation)
	for _, relation := range all {
		byTo[relation.To] = append(byTo[relation.To], relation)
		if relation.Source != nil {
			byFile[relation.Source.File] = append(byFile[relation.Source.File], relation)
		}
	}
	return all, byTo, byFile
}

func changedRelationFiles(
	previous map[string][]api.ProjectRelation,
	current map[string][]api.ProjectRelation,
) []string {
	changed := make(map[string]struct{})
	for file, relations := range previous {
		if !reflect.DeepEqual(relations, current[file]) {
			changed[file] = struct{}{}
		}
	}
	for file, relations := range current {
		if !reflect.DeepEqual(relations, previous[file]) {
			changed[file] = struct{}{}
		}
	}
	files := make([]string, 0, len(changed))
	for file := range changed {
		files = append(files, file)
	}
	sort.Strings(files)
	return files
}

func cloneRelations(relations []api.ProjectRelation) []api.ProjectRelation {
	if relations == nil {
		return nil
	}
	result := make([]api.ProjectRelation, len(relations))
	for index, relation := range relations {
		result[index] = relation
		result[index].Source = cloneSource(relation.Source)
		result[index].Metadata = append([]byte(nil), relation.Metadata...)
	}
	return result
}

func sortRelations(relations []api.ProjectRelation) {
	sort.Slice(relations, func(left, right int) bool {
		leftFile, leftLine, leftColumn := relationPosition(relations[left])
		rightFile, rightLine, rightColumn := relationPosition(relations[right])
		if leftFile != rightFile {
			return leftFile < rightFile
		}
		if leftLine != rightLine {
			return leftLine < rightLine
		}
		if leftColumn != rightColumn {
			return leftColumn < rightColumn
		}
		return relations[left].ID < relations[right].ID
	})
}

func relationPosition(relation api.ProjectRelation) (string, int, int) {
	if relation.Source == nil {
		return "", 0, 0
	}
	column := 0
	if relation.Source.Column != nil {
		column = *relation.Source.Column
	}
	return relation.Source.File, relation.Source.Line, column
}
