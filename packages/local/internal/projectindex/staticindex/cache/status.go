package cache

import (
	"encoding/json"
	"runtime"
	"sync"
)

type manifestFileStatus struct {
	File       string
	Entry      manifestEntry
	Extraction Extraction
	Hit        bool
}

func manifestFileStatuses(
	root string,
	files []string,
	compilerInputs []json.RawMessage,
	configFiles []sourceHashRecord,
	entries map[string]manifestEntry,
	sourceHashes *sourceHashMemo,
) []manifestFileStatus {
	statuses := make([]manifestFileStatus, len(files))
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
				entry, extraction, hit := manifestHit(manifestHitInput{
					Root:           root,
					File:           file,
					CompilerInputs: compilerInputs,
					ConfigFiles:    configFiles,
					Entries:        entries,
					SourceHashes:   sourceHashes,
				})
				statuses[index] = manifestFileStatus{
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

type sourceHashMemo struct {
	mu     sync.Mutex
	values map[string]sourceHashResult
}

type sourceHashResult struct {
	hash string
	ok   bool
}

func newSourceHashMemo() *sourceHashMemo {
	return &sourceHashMemo{values: map[string]sourceHashResult{}}
}

func (memo *sourceHashMemo) Read(file string) (string, bool) {
	if memo == nil {
		return sourceHash(file, nil)
	}
	memo.mu.Lock()
	if result, ok := memo.values[file]; ok {
		memo.mu.Unlock()
		return result.hash, result.ok
	}
	memo.mu.Unlock()

	hash, ok := sourceHash(file, nil)

	memo.mu.Lock()
	memo.values[file] = sourceHashResult{hash: hash, ok: ok}
	memo.mu.Unlock()
	return hash, ok
}
