package commands

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
)

func TestValidateOneShotProjectRootExplainsNonProjectWithResolvedRoot(t *testing.T) {
	root := t.TempDir()
	_, err := validateOneShotProjectRoot(root, "")
	if err == nil {
		t.Fatal("non-project root succeeded")
	}
	want := "this directory doesn't look like a Crux project (no crux config or package.json found at " + filepath.Clean(root) + ")"
	if err.Error() != want {
		t.Fatalf("error = %q, want %q", err, want)
	}
}

func TestOfflineIndexWorkerLifecycleLogsStayQuiet(t *testing.T) {
	var stdout, stderr bytes.Buffer
	io := output.NewTestIO(&stdout, &stderr, output.TestIOOptions{})
	err := runLint(
		context.Background(),
		io,
		lintOptions{root: ".", profile: "recommended"},
		func(_ context.Context, _ oneshot.Options, process commandWorkerProcess) (oneshot.Result, error) {
			process.logger.Info("worker process started", "script", "project-indexer-worker")
			return oneshot.Result{}, context.Canceled
		},
	)
	if err == nil {
		t.Fatal("lint unexpectedly succeeded")
	}
	if strings.Contains(stderr.String(), "worker process started") {
		t.Fatalf("stderr leaked worker lifecycle log: %q", stderr.String())
	}
}
