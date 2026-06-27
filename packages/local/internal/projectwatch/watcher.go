package projectwatch

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const defaultDebounce = 250 * time.Millisecond

// Watcher observes project source/config changes and emits debounced deltas.
//
// The watcher owns side effects only: filesystem subscription, timers, and
// goroutines. Classification, coalescing, and queue transitions live in pure
// helpers so incremental indexing behavior stays easy to test.
type Watcher struct {
	root     string
	debounce time.Duration
	onDelta  func(Delta)
}

// New creates a project watcher from options.
func New(options Options) (*Watcher, error) {
	if options.Root == "" {
		return nil, fmt.Errorf("project watcher requires root")
	}
	if options.OnDelta == nil {
		return nil, fmt.Errorf("project watcher requires OnDelta")
	}
	root, err := filepath.Abs(options.Root)
	if err != nil {
		return nil, fmt.Errorf("resolve project watcher root: %w", err)
	}
	debounce := options.Debounce
	if debounce <= 0 {
		debounce = defaultDebounce
	}
	return &Watcher{root: filepath.Clean(root), debounce: debounce, onDelta: options.OnDelta}, nil
}

// Run starts watching until the context is cancelled.
func (w *Watcher) Run(ctx context.Context) error {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create project watcher: %w", err)
	}
	defer fsWatcher.Close()

	if err := addProjectDirs(fsWatcher, w.root); err != nil {
		return err
	}

	events := make(chan classifiedEvent)
	go w.dispatch(ctx, events)

	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-fsWatcher.Errors:
			if err != nil {
				slog.Warn("project watcher error", "error", err)
			}
		case event := <-fsWatcher.Events:
			classified, ok := classifyFsEvent(w.root, event)
			if !ok {
				continue
			}
			if classified.addDirectory {
				if err := addProjectDirs(fsWatcher, classified.path); err != nil {
					slog.Warn("project watcher add directory failed", "path", classified.path, "error", err)
				}
				continue
			}
			select {
			case events <- classified:
			case <-ctx.Done():
				return nil
			}
		}
	}
}

func (w *Watcher) dispatch(ctx context.Context, events <-chan classifiedEvent) {
	acc := newDeltaAccumulator()
	var timer *time.Timer
	var timerC <-chan time.Time

	flush := func() {
		if acc.empty() {
			return
		}
		w.onDelta(acc.delta())
		acc = newDeltaAccumulator()
	}

	for {
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			flush()
			return
		case event := <-events:
			if event.deleted {
				acc.addDeleted(event.path)
			} else {
				acc.addChanged(event.path)
			}
			if timer == nil {
				timer = time.NewTimer(w.debounce)
				timerC = timer.C
				continue
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(w.debounce)
		case <-timerC:
			flush()
			timer = nil
			timerC = nil
		}
	}
}

func addProjectDirs(watcher *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && shouldIgnoreDir(path) {
			return filepath.SkipDir
		}
		if err := watcher.Add(path); err != nil {
			return fmt.Errorf("watch project directory %s: %w", path, err)
		}
		return nil
	})
}

type classifiedEvent struct {
	path         string
	deleted      bool
	addDirectory bool
}

func classifyFsEvent(root string, event fsnotify.Event) (classifiedEvent, bool) {
	path := filepath.Clean(event.Name)
	if path == "" || pathInsideIgnoredDir(root, path) {
		return classifiedEvent{}, false
	}
	if event.Op&(fsnotify.Create) != 0 {
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			if shouldIgnoreDir(path) {
				return classifiedEvent{}, false
			}
			return classifiedEvent{path: path, addDirectory: true}, true
		}
	}
	if !shouldWatchFile(path) {
		return classifiedEvent{}, false
	}
	if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
		return classifiedEvent{path: path, deleted: true}, true
	}
	if event.Op&(fsnotify.Write|fsnotify.Create) != 0 {
		return classifiedEvent{path: path}, true
	}
	return classifiedEvent{}, false
}

// Runner serializes incremental reindex work and coalesces deltas that arrive
// while a previous run is still executing.
type Runner struct {
	mu      sync.Mutex
	state   queueState
	handler func(context.Context, Run)
}

// NewRunner creates a single-flight delta runner.
func NewRunner(handler func(context.Context, Run)) *Runner {
	return &Runner{handler: handler}
}

// Enqueue schedules delta processing. It returns immediately.
func (r *Runner) Enqueue(ctx context.Context, delta Delta) {
	r.mu.Lock()
	transition := enqueueDelta(r.state, delta)
	r.state = transition.state
	r.mu.Unlock()
	if transition.action == queueActionStart {
		go r.run(ctx, transition.run)
	}
}

func (r *Runner) run(ctx context.Context, run Run) {
	for {
		r.handler(ctx, run)
		r.mu.Lock()
		transition := completeRun(r.state)
		r.state = transition.state
		r.mu.Unlock()
		if transition.action != queueActionContinue {
			return
		}
		run = transition.run
	}
}
