package frontendstream

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

func TestSendStreamsSyntaxRecordsAsStartChunksAndDone(t *testing.T) {
	records := []json.RawMessage{
		json.RawMessage(`{"file":"src/one.ts"}`),
		json.RawMessage(`{"file":"src/two.ts"}`),
	}
	parser := &recordingParser{records: records}
	req := requestwire.Request{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            "/repo",
		ConfigPath:      "/repo/crux.config.ts",
		ProjectName:     "project",
		SyntaxRecords:   []json.RawMessage{json.RawMessage(`{"should":"not-start"}`)},
	}
	plan := projectindex.ProjectStaticSyntaxPlan{
		Root:         "/repo",
		FilesToParse: []string{"/repo/src/one.ts", "/repo/src/two.ts"},
		CallNames:    []string{"prompt"},
	}
	var sent []any

	timing, err := Send(context.Background(), func(req any) error {
		sent = append(sent, req)
		return nil
	}, req, "request-1", plan, parser)

	if err != nil {
		t.Fatalf("Send error = %v", err)
	}
	if len(parser.requests) != 2 || parser.requests[0].File != "/repo/src/one.ts" || parser.requests[1].File != "/repo/src/two.ts" {
		t.Fatalf("parser requests = %+v, want plan files", parser.requests)
	}
	if timing.RecordCount != 2 || timing.RecordBytes != len(records[0])+len(records[1]) || timing.ChunkCount != 1 {
		t.Fatalf("timing = %+v, want two records in one chunk", timing)
	}
	if len(sent) != 3 {
		t.Fatalf("sent requests = %d, want start, chunk, done", len(sent))
	}
	start, ok := sent[0].(requestwire.Request)
	if !ok {
		t.Fatalf("start type = %T, want requestwire.Request", sent[0])
	}
	if start.RequestKind != "start" || start.RequestID != "request-1" || len(start.SyntaxRecords) != 0 {
		t.Fatalf("start = %+v, want compact start request", start)
	}
	chunk, ok := sent[1].(workerproc.RawJSONLine)
	if !ok {
		t.Fatalf("chunk type = %T, want raw JSON line", sent[1])
	}
	var chunkReq requestwire.Request
	if err := json.Unmarshal(chunk, &chunkReq); err != nil {
		t.Fatalf("unmarshal chunk: %v", err)
	}
	if chunkReq.RequestKind != "syntaxRecords" || chunkReq.RequestID != "request-1" || len(chunkReq.SyntaxRecordsBatch) != 2 {
		t.Fatalf("chunk = %+v, want syntax record batch", chunkReq)
	}
	done, ok := sent[2].(requestwire.Request)
	if !ok {
		t.Fatalf("done type = %T, want requestwire.Request", sent[2])
	}
	if done.RequestKind != "done" || done.RequestID != "request-1" {
		t.Fatalf("done = %+v, want done request", done)
	}
}

func TestSendPropagatesParserErrors(t *testing.T) {
	parser := &recordingParser{err: fmt.Errorf("parse failed")}

	_, err := Send(context.Background(), func(any) error { return nil }, requestwire.Request{
		Method: "indexProjectAstFromSyntaxRecords",
		Root:   "/repo",
	}, "request-1", projectindex.ProjectStaticSyntaxPlan{Root: "/repo", Files: []string{"/repo/src/one.ts"}}, parser)

	if err == nil || err.Error() != "parse failed" {
		t.Fatalf("Send error = %v, want parser failure", err)
	}
}

type recordingParser struct {
	requests []frontend.Request
	records  []json.RawMessage
	err      error
}

func (p *recordingParser) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called")
}

func (p *recordingParser) ParseFilesStream(_ context.Context, requests []frontend.Request, handle frontend.RecordHandler) error {
	p.requests = append([]frontend.Request(nil), requests...)
	if p.err != nil {
		return p.err
	}
	for index, record := range p.records {
		if err := handle(index, record); err != nil {
			return err
		}
	}
	return nil
}

func (p *recordingParser) Concurrency() int { return 1 }

func (p *recordingParser) Close() error { return nil }

var _ frontend.StreamParser = (*recordingParser)(nil)
