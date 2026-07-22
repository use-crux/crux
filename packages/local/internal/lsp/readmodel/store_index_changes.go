package readmodel

import (
	"reflect"
	"sort"
)

func changedIndexFiles[T any](previous, current map[string][]T) []string {
	changed := make(map[string]struct{})
	for file, values := range previous {
		if !reflect.DeepEqual(values, current[file]) {
			changed[file] = struct{}{}
		}
	}
	for file, values := range current {
		if !reflect.DeepEqual(values, previous[file]) {
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
