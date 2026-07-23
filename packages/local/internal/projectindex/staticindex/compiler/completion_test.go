package compiler

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestCompletionUsesPersistentCompilerWorker(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script subprocess test requires a POSIX shell")
	}
	logPath := filepath.Join(t.TempDir(), "requests.log")
	scriptPath := filepath.Join(t.TempDir(), "completion-worker.sh")
	script := `while IFS= read -r line; do
printf '%s\n' "$line" >> '` + logPath + `'
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
printf '{"id":%s,"ok":true,"response":{"isIncomplete":false,"items":[{"id":"prompt:writer","kind":"prompt","label":"writer","detail":"prompt · prompt:writer","insertText":"writer","replacement":{"start":{"line":2,"character":32},"end":{"line":2,"character":34}}}]}}\n' "$id"
done
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	worker := New("/bin/sh", scriptPath)
	defer worker.Close()
	query := protocol.CompletionQuery{
		File:       "src/agent.ts",
		LanguageID: "typescript",
		Source:     "const writer = prompt({ id: 'writer' })\nconst lookup = tool({ id: 'lookup' })\nconst support = agent({ prompt: wr",
		Position:   protocol.CompletionPosition{Line: 2, Character: 34},
		Candidates: []protocol.CompletionCandidate{{
			ID: "prompt:writer", Kind: "prompt", Name: "writer", Binding: "writer", File: "src/agent.ts",
		}},
		Limit: 100,
	}

	first, err := worker.Completion(context.Background(), query)
	if err != nil {
		t.Fatalf("Completion() error = %v", err)
	}
	second, err := worker.Completion(context.Background(), query)
	if err != nil {
		t.Fatalf("second Completion() error = %v", err)
	}
	if len(first.Items) != 1 || first.Items[0].Label != "writer" || len(second.Items) != 1 {
		t.Fatalf("completion results = %+v / %+v, want writer twice", first, second)
	}
	requests, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(requests); countLines(got) != 2 {
		t.Fatalf("worker requests = %q, want two calls on one persistent process", got)
	}
}

func countLines(value string) int {
	count := 0
	for _, character := range value {
		if character == '\n' {
			count++
		}
	}
	return count
}
