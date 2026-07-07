package projectwatch

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestNewUsesLowLatencyDefaultDebounce(t *testing.T) {
	watcher, err := New(Options{
		Root:    t.TempDir(),
		OnDelta: func(Delta) {},
	})
	if err != nil {
		t.Fatalf("New watcher: %v", err)
	}

	if watcher.debounce < 20*time.Millisecond || watcher.debounce > 30*time.Millisecond {
		t.Fatalf("default debounce = %s, want low-latency 20-30ms settle window", watcher.debounce)
	}
}

func TestClassifyFsEventMapsWritesAndDeletes(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "src", "prompt.ts")
	if err := os.MkdirAll(filepath.Dir(source), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(source, []byte("export {}"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	changed, ok := classifyFsEvent(root, fsnotify.Event{Name: source, Op: fsnotify.Write})
	if !ok || changed.deleted || changed.path != source {
		t.Fatalf("changed = %+v ok=%v, want changed source", changed, ok)
	}

	deleted, ok := classifyFsEvent(root, fsnotify.Event{Name: source, Op: fsnotify.Remove})
	if !ok || !deleted.deleted || deleted.path != source {
		t.Fatalf("deleted = %+v ok=%v, want deleted source", deleted, ok)
	}
}

func TestClassifyFsEventAddsCreatedDirectories(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "src", "nested")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	event, ok := classifyFsEvent(root, fsnotify.Event{Name: dir, Op: fsnotify.Create})
	if !ok || !event.addDirectory || event.path != dir {
		t.Fatalf("event = %+v ok=%v, want add directory event", event, ok)
	}
}

func TestClassifyFsEventIgnoresGeneratedPaths(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "node_modules", "pkg", "index.ts")
	event, ok := classifyFsEvent(root, fsnotify.Event{Name: path, Op: fsnotify.Write})
	if ok {
		t.Fatalf("event = %+v, want ignored", event)
	}
}
