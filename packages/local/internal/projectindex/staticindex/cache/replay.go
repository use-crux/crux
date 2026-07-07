package cache

import (
	"encoding/json"
	"fmt"
	"runtime"
	"sort"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type replayResult struct {
	fact json.RawMessage
	err  error
}

func ReplayFacts(
	root string,
	projectName string,
	cacheHits []protocol.SourceFile,
) ([]json.RawMessage, error) {
	if len(cacheHits) == 0 {
		return []json.RawMessage{}, nil
	}

	results := make([]replayResult, len(cacheHits))
	workerCount := runtime.GOMAXPROCS(0)
	if workerCount < 1 {
		workerCount = 1
	}
	if workerCount > len(cacheHits) {
		workerCount = len(cacheHits)
	}

	jobs := make(chan int)
	var wg sync.WaitGroup
	for index := 0; index < workerCount; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				results[index].fact, results[index].err = replayFact(root, projectName, cacheHits[index])
			}
		}()
	}
	for index := range cacheHits {
		jobs <- index
	}
	close(jobs)
	wg.Wait()

	facts := make([]json.RawMessage, 0, len(cacheHits))
	for index, result := range results {
		if result.err != nil {
			return nil, fmt.Errorf("Static Index cache replay %s: %w", cacheHits[index].File, result.err)
		}
		if len(result.fact) > 0 {
			facts = append(facts, result.fact)
		}
	}
	return facts, nil
}

func replayFact(root string, projectName string, hit protocol.SourceFile) (json.RawMessage, error) {
	if hit.CacheKey == "" {
		return nil, fmt.Errorf("missing cache key")
	}
	extraction, err := ReadExtraction(root, hit.CacheKey)
	if err != nil {
		return nil, err
	}
	file := extraction.File
	if file == "" {
		file = hit.File
	}
	dependencies := uniqueStrings(extraction.Dependencies)
	hasFacts := len(extraction.Definitions) > 0 || len(extraction.Relations) > 0 || len(extraction.Diagnostics) > 0
	if !hasFacts && len(dependencies) == 0 {
		return nil, nil
	}

	group := struct {
		Root        string                  `json:"root,omitempty"`
		ProjectName string                  `json:"projectName,omitempty"`
		Definitions []json.RawMessage       `json:"definitions,omitempty"`
		Relations   []json.RawMessage       `json:"relations,omitempty"`
		Diagnostics []json.RawMessage       `json:"diagnostics,omitempty"`
		Sources     []store.IndexSourceFile `json:"sources,omitempty"`
	}{
		Root:        root,
		ProjectName: projectName,
		Definitions: extraction.Definitions,
		Relations:   extraction.Relations,
		Diagnostics: extraction.Diagnostics,
		Sources: []store.IndexSourceFile{{
			File:          file,
			Status:        "indexed",
			SourceHash:    hit.SourceHash,
			InterfaceHash: extraction.InterfaceHash,
			Dependencies:  dependencies,
		}},
	}
	fact, err := json.Marshal(group)
	if err != nil {
		return nil, err
	}
	return fact, nil
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
