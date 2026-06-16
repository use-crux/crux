package qualityfs

import (
	"path/filepath"
	"sync"
	"testing"
)

func TestJSONLineAppenderConcurrentWritesRemainParseable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := appendJSONLine(path, map[string]any{"i": i}); err != nil {
				t.Errorf("append line %d: %v", i, err)
			}
		}()
	}
	wg.Wait()

	records, err := readJSONLines(path)
	if err != nil {
		t.Fatalf("read lines: %v", err)
	}
	if len(records) != 100 {
		t.Fatalf("record count = %d, want 100", len(records))
	}
}
