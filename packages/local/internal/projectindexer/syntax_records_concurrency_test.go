package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func TestWorkerCollectProjectSyntaxRecordsUsesParserConcurrency(t *testing.T) {
	root := t.TempDir()
	files := []string{
		fileWithSource(t, root, "src/one.ts"),
		fileWithSource(t, root, "src/two.ts"),
		fileWithSource(t, root, "src/three.ts"),
	}
	parser := newBlockingSyntaxParser(2, len(files))
	worker := &Worker{syntaxParser: parser}

	resultCh := make(chan struct {
		records []json.RawMessage
		err     error
	}, 1)
	go func() {
		records, err := worker.collectProjectSyntaxRecords(context.Background(), devtools.ProjectStaticSyntaxPlan{
			Root:             root,
			Files:            files,
			CallNames:        []string{"prompt"},
			ConstructorNames: []string{"Agent"},
		})
		resultCh <- struct {
			records []json.RawMessage
			err     error
		}{records: records, err: err}
	}()

	parser.waitForStarted(t, 2)
	select {
	case <-parser.started:
		t.Fatal("third parse started before one of the two parser slots was released")
	case <-time.After(50 * time.Millisecond):
	}

	close(parser.release)
	result := waitForSyntaxRecordResult(t, resultCh)
	if result.err != nil {
		t.Fatalf("collectProjectSyntaxRecords error = %v", result.err)
	}
	if len(result.records) != len(files) {
		t.Fatalf("records = %d, want %d", len(result.records), len(files))
	}
	if got := parser.maxInFlight.Load(); got != 2 {
		t.Fatalf("max in-flight parses = %d, want 2", got)
	}
}

func TestWorkerCollectProjectSyntaxRecordsBatchUsesDiskSourceHandoff(t *testing.T) {
	root := t.TempDir()
	files := []string{
		filepath.Join(root, "src", "one.ts"),
		filepath.Join(root, "src", "two.ts"),
	}
	parser := &recordingBatchSyntaxParser{}
	worker := &Worker{syntaxParser: parser}

	records, err := worker.collectProjectSyntaxRecords(context.Background(), devtools.ProjectStaticSyntaxPlan{
		Root:                     root,
		Files:                    files,
		CallNames:                []string{"prompt"},
		CallInterests:            []devtools.StaticCallInterest{{Name: "defineWorkflow", ImportFrom: []string{"@acme/workflows"}}},
		ConstructorNames:         []string{"Agent"},
		ConstructorInterests:     []devtools.StaticConstructorInterest{{Name: "Agent", ImportFrom: []string{"@crux/core"}}},
		PruneNativeFactCallNames: []string{"router", "cascade"},
	})
	if err != nil {
		t.Fatalf("collectProjectSyntaxRecords error = %v", err)
	}
	if len(records) != len(files) {
		t.Fatalf("records = %d, want %d", len(records), len(files))
	}
	if len(parser.requests) != len(files) {
		t.Fatalf("batch requests = %d, want %d", len(parser.requests), len(files))
	}
	for index, request := range parser.requests {
		if request.File != files[index] {
			t.Fatalf("request[%d].File = %q, want %q", index, request.File, files[index])
		}
		if request.Source != "" {
			t.Fatalf("request[%d].Source length = %d, want 0", index, len(request.Source))
		}
		if !request.ReadSourceFromDisk {
			t.Fatalf("request[%d].ReadSourceFromDisk = false, want true", index)
		}
		if got := fmt.Sprint(request.PruneNativeFactCallNames); got != "[router cascade]" {
			t.Fatalf("request[%d].PruneNativeFactCallNames = %s, want [router cascade]", index, got)
		}
		if len(request.CallInterests) != 1 || request.CallInterests[0].Name != "defineWorkflow" || fmt.Sprint(request.CallInterests[0].ImportFrom) != "[@acme/workflows]" {
			t.Fatalf("request[%d].CallInterests = %+v, want defineWorkflow from @acme/workflows", index, request.CallInterests)
		}
		if len(request.ConstructorInterests) != 1 || request.ConstructorInterests[0].Name != "Agent" || fmt.Sprint(request.ConstructorInterests[0].ImportFrom) != "[@crux/core]" {
			t.Fatalf("request[%d].ConstructorInterests = %+v, want Agent from @crux/core", index, request.ConstructorInterests)
		}
	}
}

func TestWorkerCollectProjectSyntaxRecordsUsesFilesToParse(t *testing.T) {
	root := t.TempDir()
	files := []string{
		fileWithSource(t, root, "src/one.ts"),
		fileWithSource(t, root, "src/two.ts"),
	}
	parser := &recordingSyntaxParser{concurrency: 2}
	worker := &Worker{syntaxParser: parser}

	records, err := worker.collectProjectSyntaxRecords(context.Background(), devtools.ProjectStaticSyntaxPlan{
		Root:             root,
		Files:            files,
		FilesToParse:     files[1:],
		CallNames:        []string{"prompt"},
		ConstructorNames: []string{"Agent"},
	})
	if err != nil {
		t.Fatalf("collectProjectSyntaxRecords error = %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("records = %d, want 1", len(records))
	}
	if len(parser.requests) != 1 {
		t.Fatalf("parse requests = %d, want 1", len(parser.requests))
	}
	if got, want := parser.requests[0].File, files[1]; got != want {
		t.Fatalf("parsed file = %q, want %q", got, want)
	}
}

func TestSyntaxParseRequestsFromPlanUsesEmptyFilesToParse(t *testing.T) {
	root := t.TempDir()
	files := []string{
		filepath.Join(root, "src", "one.ts"),
		filepath.Join(root, "src", "two.ts"),
	}

	requests := projectSyntaxParseRequestsFromPlan(devtools.ProjectStaticSyntaxPlan{
		Root:             root,
		Files:            files,
		FilesToParse:     []string{},
		CallNames:        []string{"prompt"},
		ConstructorNames: []string{"Agent"},
	})

	if len(requests) != 0 {
		t.Fatalf("requests = %d, want 0", len(requests))
	}
}

func TestAdaptiveSyntaxPoolCount(t *testing.T) {
	tests := []struct {
		name        string
		requests    int
		maxWorkers  int
		wantWorkers int
	}{
		{name: "single", requests: 1, maxWorkers: 4, wantWorkers: 1},
		{name: "small", requests: 32, maxWorkers: 4, wantWorkers: 1},
		{name: "current repo sized", requests: 422, maxWorkers: 4, wantWorkers: 1},
		{name: "medium", requests: 1024, maxWorkers: 4, wantWorkers: 2},
		{name: "large", requests: 2400, maxWorkers: 4, wantWorkers: 4},
		{name: "clamped medium", requests: 1024, maxWorkers: 1, wantWorkers: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := syntax.AdaptiveWorkerCount(test.requests, test.maxWorkers); got != test.wantWorkers {
				t.Fatalf("syntax.AdaptiveWorkerCount(%d, %d) = %d, want %d", test.requests, test.maxWorkers, got, test.wantWorkers)
			}
		})
	}
}

func TestSyntaxPoolActiveWorkerCount(t *testing.T) {
	adaptive := syntax.NewAdaptivePool(4, "")
	if got := adaptive.ActiveWorkerCount(16); got != 1 {
		t.Fatalf("adaptive active workers for small project = %d, want 1", got)
	}
	if got := adaptive.ActiveWorkerCount(128); got != 1 {
		t.Fatalf("adaptive active workers for small project = %d, want 1", got)
	}
	if got := adaptive.ActiveWorkerCount(422); got != 1 {
		t.Fatalf("adaptive active workers for current repo sized project = %d, want 1", got)
	}
	if got := adaptive.ActiveWorkerCount(1024); got != 2 {
		t.Fatalf("adaptive active workers for medium project = %d, want 2", got)
	}
	if got := adaptive.ActiveWorkerCount(2400); got != 4 {
		t.Fatalf("adaptive active workers for large project = %d, want 4", got)
	}
	fixed := syntax.NewPool(4, "")
	if got := fixed.ActiveWorkerCount(16); got != 4 {
		t.Fatalf("fixed active workers = %d, want 4", got)
	}
	if got := fixed.ActiveWorkerCount(2); got != 2 {
		t.Fatalf("fixed active workers should clamp to requests = %d, want 2", got)
	}
}

func fileWithSource(t *testing.T, root string, rel string) string {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte("export const value = prompt({ id: 'value' })"), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

type recordingSyntaxParser struct {
	concurrency int
	requests    []syntax.Request
}

func (p *recordingSyntaxParser) ParseFile(_ context.Context, request syntax.Request) (json.RawMessage, error) {
	p.requests = append(p.requests, request)
	return json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":%q,"sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, request.File)), nil
}

func (p *recordingSyntaxParser) Concurrency() int {
	return p.concurrency
}

func (p *recordingSyntaxParser) Close() error {
	return nil
}

type recordingBatchSyntaxParser struct {
	requests []syntax.Request
}

func (p *recordingBatchSyntaxParser) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called")
}

func (p *recordingBatchSyntaxParser) ParseFiles(_ context.Context, requests []syntax.Request) ([]json.RawMessage, error) {
	p.requests = append([]syntax.Request(nil), requests...)
	records := make([]json.RawMessage, 0, len(requests))
	for _, request := range requests {
		records = append(records, json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":%q,"sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, request.File)))
	}
	return records, nil
}

func (p *recordingBatchSyntaxParser) Concurrency() int {
	return 1
}

func (p *recordingBatchSyntaxParser) Close() error {
	return nil
}

type blockingSyntaxParser struct {
	concurrency int
	started     chan struct{}
	release     chan struct{}
	inFlight    atomic.Int32
	maxInFlight atomic.Int32
}

func newBlockingSyntaxParser(concurrency int, fileCount int) *blockingSyntaxParser {
	return &blockingSyntaxParser{
		concurrency: concurrency,
		started:     make(chan struct{}, fileCount),
		release:     make(chan struct{}),
	}
}

func (p *blockingSyntaxParser) ParseFile(ctx context.Context, request syntax.Request) (json.RawMessage, error) {
	inFlight := p.inFlight.Add(1)
	defer p.inFlight.Add(-1)
	for {
		maxSeen := p.maxInFlight.Load()
		if inFlight <= maxSeen || p.maxInFlight.CompareAndSwap(maxSeen, inFlight) {
			break
		}
	}
	p.started <- struct{}{}
	select {
	case <-p.release:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":%q,"sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}`, request.File)), nil
}

func (p *blockingSyntaxParser) Concurrency() int {
	return p.concurrency
}

func (p *blockingSyntaxParser) Close() error {
	return nil
}

func (p *blockingSyntaxParser) waitForStarted(t *testing.T, count int) {
	t.Helper()
	for i := 0; i < count; i++ {
		select {
		case <-p.started:
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for parse %d to start", i+1)
		}
	}
}

func waitForSyntaxRecordResult(t *testing.T, resultCh <-chan struct {
	records []json.RawMessage
	err     error
}) struct {
	records []json.RawMessage
	err     error
} {
	t.Helper()
	select {
	case result := <-resultCh:
		return result
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for syntax record collection")
		return struct {
			records []json.RawMessage
			err     error
		}{}
	}
}
