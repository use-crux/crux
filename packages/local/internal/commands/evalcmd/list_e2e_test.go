package evalcmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/assets"
)

func TestEvalListUsesTheSeparateEmbeddedCoordinator(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	project := filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "local-workers", "lib", "__fixtures__", "eval-project")
	if _, err := os.Stat(filepath.Join(project, "evals", "managed.eval.ts")); err != nil {
		t.Fatalf("fixture path %s: %v", project, err)
	}
	node, err := assets.FindNode()
	if err != nil {
		t.Fatal(err)
	}
	worker, err := assets.ExtractEmbeddedEvalCoordinator()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(node, worker, "--list")
	cmd.Dir = project
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Eval coordinator list: %v\n%s", err, output)
	}
	for _, want := range []string{
		`"id":"managed"`,
		`"relativeFile":"evals/managed.eval.ts"`,
		`"id":"support"`,
		`"relativeFile":"evals/support.eval.ts"`,
	} {
		if !strings.Contains(string(output), want) {
			t.Fatalf("Eval coordinator output missing %q: %q", want, output)
		}
	}
}

func TestEvalListLoadsTheShippedNodeExample(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	project := filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "examples", "node-basic")
	if _, err := os.Stat(filepath.Join(project, "evals", "citations.eval.ts")); err != nil {
		t.Fatalf("example path %s: %v", project, err)
	}
	node, err := assets.FindNode()
	if err != nil {
		t.Fatal(err)
	}
	worker, err := assets.ExtractEmbeddedEvalCoordinator()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(node, worker, "--list")
	cmd.Dir = project
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("list shipped Node Eval example: %v\n%s", err, output)
	}
	for _, want := range []string{
		`"id":"examples.support-citations"`,
		`"relativeFile":"evals/citations.eval.ts"`,
	} {
		if !strings.Contains(string(output), want) {
			t.Fatalf("Eval coordinator output missing %q: %q", want, output)
		}
	}
}
