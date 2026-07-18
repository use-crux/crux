package evalcmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

var evalWatchIgnored = map[string]bool{
	"node_modules": true,
	".git":         true,
	".crux":        true,
	"dist":         true,
	".next":        true,
	".turbo":       true,
}

// Watch always invokes the normal planner; exact task and scorer evidence
// decide reuse independently, with no hidden rescore mode.
func runEvalWatch(cmd *cobra.Command, f *cli.Factory, opts runOptions, maxCostSet bool) error {
	root := opts.cwd
	if root == "" {
		root = projectroot.Dir()
	}
	if root == "" {
		return fmt.Errorf("no project root found; pass --cwd")
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer watcher.Close()
	if err := addEvalWatchDirs(watcher, root); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(cmd.ErrOrStderr(), "watching %s; Ctrl-C to stop\n", root)
	for {
		if err := runEvals(cmd, f, opts, maxCostSet); err != nil {
			_, _ = fmt.Fprintf(cmd.ErrOrStderr(), "Eval run failed: %v\n", err)
		}
		if !awaitEvalChange(watcher) {
			return nil
		}
		if err := addEvalWatchDirs(watcher, root); err != nil {
			return err
		}
		_, _ = fmt.Fprintln(cmd.ErrOrStderr(), "change detected; replanning affected selected Evals")
	}
}

func addEvalWatchDirs(watcher *fsnotify.Watcher, root string) error {
	registered := make(map[string]bool, len(watcher.WatchList()))
	for _, path := range watcher.WatchList() {
		registered[path] = true
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || !entry.IsDir() {
			return nil
		}
		if evalWatchIgnored[entry.Name()] {
			return filepath.SkipDir
		}
		if registered[path] {
			return nil
		}
		return watcher.Add(path)
	})
}

func awaitEvalChange(watcher *fsnotify.Watcher) bool {
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return false
			}
			if !isRelevantEvalChange(event) {
				continue
			}
			deadline := time.After(300 * time.Millisecond)
			for {
				select {
				case <-watcher.Events:
				case <-deadline:
					return true
				}
			}
		case _, ok := <-watcher.Errors:
			if !ok {
				return false
			}
		}
	}
}

func isRelevantEvalChange(event fsnotify.Event) bool {
	if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
		return false
	}
	for part := range evalWatchIgnored {
		if strings.Contains(event.Name, string(filepath.Separator)+part+string(filepath.Separator)) {
			return false
		}
	}
	switch filepath.Ext(event.Name) {
	case ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".json", ".jsonl", ".csv":
		return true
	default:
		return false
	}
}
