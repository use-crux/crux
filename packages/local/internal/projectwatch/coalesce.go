package projectwatch

import "sort"

type deltaAccumulator struct {
	files        map[string]bool
	deletedFiles map[string]bool
}

func newDeltaAccumulator() deltaAccumulator {
	return deltaAccumulator{
		files:        map[string]bool{},
		deletedFiles: map[string]bool{},
	}
}

func (a deltaAccumulator) addChanged(path string) {
	if path == "" {
		return
	}
	delete(a.deletedFiles, path)
	a.files[path] = true
}

func (a deltaAccumulator) addDeleted(path string) {
	if path == "" {
		return
	}
	delete(a.files, path)
	a.deletedFiles[path] = true
}

func (a deltaAccumulator) empty() bool {
	return len(a.files) == 0 && len(a.deletedFiles) == 0
}

func (a deltaAccumulator) delta() Delta {
	return Delta{
		Files:        sortedKeys(a.files),
		DeletedFiles: sortedKeys(a.deletedFiles),
	}
}

func sortedKeys(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func mergeDelta(left Delta, right Delta) Delta {
	acc := newDeltaAccumulator()
	for _, path := range left.Files {
		acc.addChanged(path)
	}
	for _, path := range left.DeletedFiles {
		acc.addDeleted(path)
	}
	for _, path := range right.Files {
		acc.addChanged(path)
	}
	for _, path := range right.DeletedFiles {
		acc.addDeleted(path)
	}
	return acc.delta()
}
