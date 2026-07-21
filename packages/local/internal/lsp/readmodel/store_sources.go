package readmodel

import (
	"reflect"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func sourcesByFile(sources []api.IndexSourceFile) map[string]api.IndexSourceFile {
	result := make(map[string]api.IndexSourceFile, len(sources))
	for _, source := range sources {
		cloned := source
		cloned.DefinitionIDs = append([]string(nil), source.DefinitionIDs...)
		cloned.Dependencies = append([]string(nil), source.Dependencies...)
		cloned.Dependents = append([]string(nil), source.Dependents...)
		cloned.Diagnostics = append([]string(nil), source.Diagnostics...)
		result[source.File] = cloned
	}
	return result
}

func changedSources(previous, current map[string]api.IndexSourceFile) []string {
	changed := make(map[string]struct{})
	for file, source := range previous {
		if !reflect.DeepEqual(source, current[file]) {
			changed[file] = struct{}{}
		}
	}
	for file, source := range current {
		if !reflect.DeepEqual(source, previous[file]) {
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
