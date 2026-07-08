package qualityfs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestWriteRecordConcurrentRewritesRemainComplete(t *testing.T) {
	fs := Open(t.TempDir())
	const writers = 16
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := Put(fs, Suite{
				SuiteID:   "suite-1",
				Name:      "suite",
				CaseCount: i + 1,
			})
			if err != nil {
				errs <- err
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	path := filepath.Join(fs.dir, string(KindSuites), "suite-1.json")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Suite
	if err := json.Unmarshal(content, &decoded); err != nil {
		t.Fatalf("record is not complete JSON: %v\n%s", err, string(content))
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			t.Fatalf("temporary file was not cleaned up: %s", entry.Name())
		}
	}
}
