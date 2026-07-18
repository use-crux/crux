package workerproc

import (
	"os"
	"sync"
	"testing"
)

func TestExtractEmbeddedIsSafeAcrossConcurrentCallers(t *testing.T) {
	t.Setenv("CRUX_CACHE_DIR", t.TempDir())
	content := []byte("export const value = 42\n")
	const callers = 16

	paths := make(chan string, callers)
	errors := make(chan error, callers)
	var group sync.WaitGroup
	for range callers {
		group.Add(1)
		go func() {
			defer group.Done()
			path, err := ExtractEmbedded("fixture", content)
			paths <- path
			errors <- err
		}()
	}
	group.Wait()
	close(paths)
	close(errors)

	for err := range errors {
		if err != nil {
			t.Fatalf("ExtractEmbedded() error = %v", err)
		}
	}
	var expected string
	for path := range paths {
		if expected == "" {
			expected = path
		}
		if path != expected {
			t.Fatalf("ExtractEmbedded() path = %q, want %q", path, expected)
		}
	}
	got, err := os.ReadFile(expected)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(content) {
		t.Fatalf("extracted content = %q, want %q", got, content)
	}
}
