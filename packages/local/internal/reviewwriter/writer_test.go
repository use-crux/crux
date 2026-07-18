package reviewwriter

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/review"
)

func TestWriterInvokesProjectCoreAndRediscoversAddedCase(t *testing.T) {
	workers, err := filepath.Abs(filepath.Join("..", "..", "..", "local-workers"))
	if err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(workers, "lib", "__fixtures__", "eval-project")
	sidecar := filepath.Join(project, "evals", "managed.cases.jsonl")
	_ = os.Remove(sidecar)
	t.Cleanup(func() { _ = os.Remove(sidecar) })
	writer := Writer{
		ProjectRoot: project,
		FindNode:    assets.FindNode,
		Privacy:     privacy.Static(),
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

func TestWriterForwardsGeneratedPrivacyPolicyToSidecarWorker(t *testing.T) {
	script := filepath.Join(t.TempDir(), "worker.mjs")
	if err := os.WriteFile(script, []byte(`
let input = ''
for await (const chunk of process.stdin) input += chunk
const request = JSON.parse(input)
const result = {
  status: 'added', caseId: request.id, path: 'evals/cases.jsonl',
  row: JSON.stringify(request), diff: '+ case', unvalidatedExpected: false,
}
process.stdout.write(JSON.stringify({ type: 'review:add', result }) + '\n')
`), 0o600); err != nil {
		t.Fatal(err)
	}
	writer := Writer{
		ProjectRoot: t.TempDir(),
		FindNode:    assets.FindNode,
		Extract:     func() (string, error) { return script, nil },
		Privacy:     privacy.Static("customer.email"),
	}
	result, err := writer.AddReviewCase(context.Background(), review.AddCaseRequest{
		EvalID: "managed", ID: "private-case", Input: json.RawMessage(`{"customer":{"email":"private@example.test"}}`),
		ReviewID: "review_writer", RunID: "run_0123456789abcdef01234567", RepositoryWritable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	var forwarded review.AddCaseRequest
	if err := json.Unmarshal([]byte(result.Row), &forwarded); err != nil {
		t.Fatal(err)
	}
	if len(forwarded.RedactPaths) != 1 || forwarded.RedactPaths[0] != "customer.email" {
		t.Fatalf("forwarded redact paths = %#v", forwarded.RedactPaths)
	}
}
