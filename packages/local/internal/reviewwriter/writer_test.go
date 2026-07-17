package reviewwriter

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/review"
)

func TestWriterInvokesProjectCoreAndRediscoversAddedCase(t *testing.T) {
	workers, err := filepath.Abs(filepath.Join("..", "..", "..", "local-workers"))
	if err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(workers, "lib", "__fixtures__", "eval-project")
	script := filepath.Join(workers, "bin", "eval-coordinator.ts")
	sidecar := filepath.Join(project, "evals", "managed.cases.jsonl")
	_ = os.Remove(sidecar)
	t.Cleanup(func() { _ = os.Remove(sidecar) })
	writer := Writer{
		ProjectRoot: project,
		FindNode:    assets.FindNode,
		Extract:     func() (string, error) { return script, nil },
	}
	request := review.AddCaseRequest{
		EvalID: "managed", ID: "review-writer", Input: json.RawMessage(`{"question":"reviewed"}`),
		ReviewID: "review_writer", RunID: "run_0123456789abcdef01234567", RepositoryWritable: true,
	}

	added, err := writer.AddReviewCase(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if added.Status != "added" || added.CaseID != "review-writer" {
		t.Fatalf("added result = %#v", added)
	}
	request.ID = "semantic-link"
	linked, err := writer.AddReviewCase(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if linked.Status != "linked" || linked.CaseID != "review-writer" {
		t.Fatalf("linked result = %#v", linked)
	}
}
