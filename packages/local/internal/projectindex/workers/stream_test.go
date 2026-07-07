package workers

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

func TestWorker_chunksSyntaxRecordRequests(t *testing.T) {
	records := make([]json.RawMessage, requestwire.SyntaxRecordBatchMaxRecords+3)
	for index := range records {
		records[index] = json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/file-%03d.ts","matches":[]}`, index))
	}

	req := requestwire.Request{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            "/repo",
		ResolutionMode:  "source-only",
		SyntaxRecords:   records,
	}

	events, err := requestwire.Batch(req)
	if err != nil {
		t.Fatalf("requestwire.Batch error = %v", err)
	}
	if len(events) < 4 {
		t.Fatalf("events = %d, want start, multiple syntax record batches, and done", len(events))
	}

	start, ok := events[0].(requestwire.Request)
	if !ok {
		t.Fatalf("start event type = %T, want requestwire.Request", events[0])
	}
	if start.RequestKind != "start" || len(start.SyntaxRecords) != 0 || len(start.SyntaxRecordsBatch) != 0 {
		t.Fatalf("start event = %+v, want compact syntax-record start", start)
	}

	var totalRecords int
	for index, event := range events[1 : len(events)-1] {
		chunk, ok := event.(requestwire.Request)
		if !ok {
			t.Fatalf("chunk %d type = %T, want requestwire.Request", index, event)
		}
		if chunk.RequestKind != "syntaxRecords" {
			t.Fatalf("chunk %d requestKind = %q, want syntaxRecords", index, chunk.RequestKind)
		}
		if len(chunk.SyntaxRecords) != 0 {
			t.Fatalf("chunk %d carried full syntaxRecords payload", index)
		}
		if len(chunk.SyntaxRecordsBatch) == 0 || len(chunk.SyntaxRecordsBatch) > requestwire.SyntaxRecordBatchMaxRecords {
			t.Fatalf("chunk %d record count = %d, want 1..%d", index, len(chunk.SyntaxRecordsBatch), requestwire.SyntaxRecordBatchMaxRecords)
		}
		totalRecords += len(chunk.SyntaxRecordsBatch)
	}
	if totalRecords != len(records) {
		t.Fatalf("chunked records = %d, want %d", totalRecords, len(records))
	}

	done, ok := events[len(events)-1].(requestwire.Request)
	if !ok {
		t.Fatalf("done event type = %T, want requestwire.Request", events[len(events)-1])
	}
	if done.RequestKind != "done" || len(done.SyntaxRecords) != 0 || len(done.SyntaxRecordsBatch) != 0 {
		t.Fatalf("done event = %+v, want compact done", done)
	}
}

func TestWorker_chunksSyntaxRecordRequestsByByteBudget(t *testing.T) {
	payload := strings.Repeat("x", requestwire.SyntaxRecordBatchMaxBytes/2+1024)
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/large.ts","payload":%q}`, payload))
	records := []json.RawMessage{record, record, record}

	events, err := requestwire.Batch(requestwire.Request{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            "/repo",
		ResolutionMode:  "source-only",
		SyntaxRecords:   records,
	})
	if err != nil {
		t.Fatalf("requestwire.Batch error = %v", err)
	}

	var batchCount int
	for _, event := range events {
		chunk, ok := event.(requestwire.Request)
		if !ok || chunk.RequestKind != "syntaxRecords" {
			continue
		}
		batchCount++
		if len(chunk.SyntaxRecordsBatch) != 1 {
			t.Fatalf("syntax record batch size = %d, want 1 for byte-budgeted large records", len(chunk.SyntaxRecordsBatch))
		}
	}
	if batchCount != len(records) {
		t.Fatalf("syntax record batches = %d, want %d", batchCount, len(records))
	}
}

func TestWorker_rejectsOversizedSyntaxRecordBatch(t *testing.T) {
	payload := strings.Repeat("x", requestwire.SyntaxRecordBatchMaxBytes+1)
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/huge.ts","payload":%q}`, payload))

	_, err := requestwire.Batch(requestwire.Request{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            "/repo",
		ResolutionMode:  "source-only",
		SyntaxRecords:   []json.RawMessage{record},
	})
	if err == nil {
		t.Fatal("requestwire.Batch error = nil, want oversized record error")
	}
}

func TestProjectIndexSyntaxRecordChunkerFlushesIncrementally(t *testing.T) {
	records := make([]json.RawMessage, requestwire.SyntaxRecordBatchMaxRecords+1)
	for index := range records {
		records[index] = json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/file-%03d.ts","matches":[]}`, index))
	}

	var batches [][]json.RawMessage
	chunker := requestwire.NewRecordChunker(func(batch []json.RawMessage) error {
		copied := append([]json.RawMessage(nil), batch...)
		batches = append(batches, copied)
		return nil
	})
	for _, record := range records {
		if err := chunker.Add(record); err != nil {
			t.Fatalf("Add error = %v", err)
		}
	}
	if err := chunker.Flush(); err != nil {
		t.Fatalf("Flush error = %v", err)
	}

	if len(batches) != 2 {
		t.Fatalf("batches = %d, want 2", len(batches))
	}
	if len(batches[0]) != requestwire.SyntaxRecordBatchMaxRecords || len(batches[1]) != 1 {
		t.Fatalf("batch sizes = %d,%d", len(batches[0]), len(batches[1]))
	}
}

func TestProjectIndexSyntaxRecordBatchRequestLineEncodesRawRecords(t *testing.T) {
	record := json.RawMessage(`{"schemaVersion":1,"file":"/repo/src/one.ts","matches":[]}`)
	line := frontend.RecordBatchRequestLine("indexProjectAstFromSyntaxRecords", "request-1", []json.RawMessage{record})

	var req requestwire.Request
	if err := json.Unmarshal(line, &req); err != nil {
		t.Fatalf("unmarshal raw request line: %v", err)
	}
	if req.ProtocolVersion != 2 || req.Method != "indexProjectAstFromSyntaxRecords" || req.RequestID != "request-1" || req.RequestKind != "syntaxRecords" {
		t.Fatalf("request envelope = %+v", req)
	}
	if len(req.SyntaxRecordsBatch) != 1 || string(req.SyntaxRecordsBatch[0]) != string(record) {
		t.Fatalf("syntax record batch = %s, want %s", req.SyntaxRecordsBatch, record)
	}
}
