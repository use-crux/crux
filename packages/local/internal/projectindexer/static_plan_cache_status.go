package projectindexer

import (
	"encoding/json"
	"runtime"
	"sync"
)

type projectNativeStaticCacheManifestFileStatus struct {
	File       string
	Entry      projectNativeStaticParseCacheManifestEntry
	Extraction projectNativeStaticCachedExtraction
	Hit        bool
}

func projectNativeStaticCacheManifestFileStatuses(
	root string,
	files []string,
	compilerInputs []json.RawMessage,
	configFiles []projectNativeStaticParseCacheSourceHash,
	entries map[string]projectNativeStaticParseCacheManifestEntry,
	sourceHashes *projectNativeStaticSourceHashMemo,
) []projectNativeStaticCacheManifestFileStatus {
	statuses := make([]projectNativeStaticCacheManifestFileStatus, len(files))
	if len(files) == 0 {
		return statuses
	}
	workerCount := runtime.GOMAXPROCS(0)
	if workerCount < 1 {
		workerCount = 1
	}
	if workerCount > len(files) {
		workerCount = len(files)
	}
	if workerCount > 32 {
		workerCount = 32
	}
	jobs := make(chan int)
	var wg sync.WaitGroup
	for index := 0; index < workerCount; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				file := files[index]
				entry, extraction, hit := projectNativeStaticCacheManifestHit(projectNativeStaticCacheManifestHitInput{
					Root:           root,
					File:           file,
					CompilerInputs: compilerInputs,
					ConfigFiles:    configFiles,
					Entries:        entries,
					SourceHashes:   sourceHashes,
				})
				statuses[index] = projectNativeStaticCacheManifestFileStatus{
					File:       file,
					Entry:      entry,
					Extraction: extraction,
					Hit:        hit,
				}
			}
		}()
	}
	for index := range files {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	return statuses
}

type projectNativeStaticSourceHashMemo struct {
	mu     sync.Mutex
	values map[string]projectNativeStaticSourceHashResult
}

type projectNativeStaticSourceHashResult struct {
	hash string
	ok   bool
}

func newProjectNativeStaticSourceHashMemo() *projectNativeStaticSourceHashMemo {
	return &projectNativeStaticSourceHashMemo{values: map[string]projectNativeStaticSourceHashResult{}}
}

func (memo *projectNativeStaticSourceHashMemo) Read(file string) (string, bool) {
	if memo == nil {
		return projectNativeStaticSourceHash(file, nil)
	}
	memo.mu.Lock()
	if result, ok := memo.values[file]; ok {
		memo.mu.Unlock()
		return result.hash, result.ok
	}
	memo.mu.Unlock()

	hash, ok := projectNativeStaticSourceHash(file, nil)

	memo.mu.Lock()
	memo.values[file] = projectNativeStaticSourceHashResult{hash: hash, ok: ok}
	memo.mu.Unlock()
	return hash, ok
}
