package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectIndexWorker_chunksSyntaxRecordRequests(t *testing.T) {
	records := make([]json.RawMessage, projectIndexSyntaxRecordRequestBatchMaxRecords+3)
	for index := range records {
		records[index] = json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/file-%03d.ts","matches":[]}`, index))
	}

	req := projectIndexRequest{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            "/repo",
		ResolutionMode:  "source-only",
		SyntaxRecords:   records,
	}

	events, err := projectIndexWorkerRequestBatch(req)
	if err != nil {
		t.Fatalf("projectIndexWorkerRequestBatch error = %v", err)
	}
	if len(events) < 4 {
		t.Fatalf("events = %d, want start, multiple syntax record batches, and done", len(events))
	}

	start, ok := events[0].(projectIndexRequest)
	if !ok {
		t.Fatalf("start event type = %T, want projectIndexRequest", events[0])
	}
	if start.RequestKind != "start" || len(start.SyntaxRecords) != 0 || len(start.SyntaxRecordsBatch) != 0 {
		t.Fatalf("start event = %+v, want compact syntax-record start", start)
	}

	var totalRecords int
	for index, event := range events[1 : len(events)-1] {
		chunk, ok := event.(projectIndexRequest)
		if !ok {
			t.Fatalf("chunk %d type = %T, want projectIndexRequest", index, event)
		}
		if chunk.RequestKind != "syntaxRecords" {
			t.Fatalf("chunk %d requestKind = %q, want syntaxRecords", index, chunk.RequestKind)
		}
		if len(chunk.SyntaxRecords) != 0 {
			t.Fatalf("chunk %d carried full syntaxRecords payload", index)
		}
		if len(chunk.SyntaxRecordsBatch) == 0 || len(chunk.SyntaxRecordsBatch) > projectIndexSyntaxRecordRequestBatchMaxRecords {
			t.Fatalf("chunk %d record count = %d, want 1..%d", index, len(chunk.SyntaxRecordsBatch), projectIndexSyntaxRecordRequestBatchMaxRecords)
		}
		totalRecords += len(chunk.SyntaxRecordsBatch)
	}
	if totalRecords != len(records) {
		t.Fatalf("chunked records = %d, want %d", totalRecords, len(records))
	}

	done, ok := events[len(events)-1].(projectIndexRequest)
	if !ok {
		t.Fatalf("done event type = %T, want projectIndexRequest", events[len(events)-1])
	}
	if done.RequestKind != "done" || len(done.SyntaxRecords) != 0 || len(done.SyntaxRecordsBatch) != 0 {
		t.Fatalf("done event = %+v, want compact done", done)
	}
}

func TestProjectIndexWorker_chunksSyntaxRecordRequestsByByteBudget(t *testing.T) {
	payload := strings.Repeat("x", projectIndexSyntaxRecordRequestBatchMaxBytes/2+1024)
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/large.ts","payload":%q}`, payload))
	records := []json.RawMessage{record, record, record}

	events, err := projectIndexWorkerRequestBatch(projectIndexRequest{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            "/repo",
		ResolutionMode:  "source-only",
		SyntaxRecords:   records,
	})
	if err != nil {
		t.Fatalf("projectIndexWorkerRequestBatch error = %v", err)
	}

	var batchCount int
	for _, event := range events {
		chunk, ok := event.(projectIndexRequest)
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

func TestProjectIndexWorker_rejectsOversizedSyntaxRecordBatch(t *testing.T) {
	payload := strings.Repeat("x", projectIndexSyntaxRecordRequestBatchMaxBytes+1)
	record := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/huge.ts","payload":%q}`, payload))

	_, err := projectIndexWorkerRequestBatch(projectIndexRequest{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            "/repo",
		ResolutionMode:  "source-only",
		SyntaxRecords:   []json.RawMessage{record},
	})
	if err == nil {
		t.Fatal("projectIndexWorkerRequestBatch error = nil, want oversized record error")
	}
}

func TestProjectIndexSyntaxRecordChunkerFlushesIncrementally(t *testing.T) {
	records := make([]json.RawMessage, projectIndexSyntaxRecordRequestBatchMaxRecords+1)
	for index := range records {
		records[index] = json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"file":"/repo/src/file-%03d.ts","matches":[]}`, index))
	}

	var batches [][]json.RawMessage
	chunker := newProjectIndexSyntaxRecordChunker(func(batch []json.RawMessage) error {
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
	if len(batches[0]) != projectIndexSyntaxRecordRequestBatchMaxRecords || len(batches[1]) != 1 {
		t.Fatalf("batch sizes = %d,%d", len(batches[0]), len(batches[1]))
	}
}

func TestProjectIndexSyntaxRecordBatchRequestLineEncodesRawRecords(t *testing.T) {
	record := json.RawMessage(`{"schemaVersion":1,"file":"/repo/src/one.ts","matches":[]}`)
	line := projectIndexSyntaxRecordBatchRequestLine("indexProjectAstFromSyntaxRecords", "request-1", []json.RawMessage{record})

	var req projectIndexRequest
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

func TestProjectIndexWorker_streamsIncrementalPreviousIndexRequestBatches(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "project-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		let root = ''
		let definitions = 0
		let sources = 0
		let startWasCompact = false

		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.root) root = req.root
			if (req.requestKind === 'start') {
				const compactDefinitions = !('definitions' in req.previousIndex) ||
					(Array.isArray(req.previousIndex.definitions) && req.previousIndex.definitions.length === 0)
				const compactSources = !('sources' in req.previousIndex) ||
					(Array.isArray(req.previousIndex.sources) && req.previousIndex.sources.length === 0)
				startWasCompact =
					req.method === 'indexProjectIncremental' &&
					req.previousIndex &&
					compactDefinitions &&
					compactSources
			}
			if (req.requestKind === 'previousIndex:definitions') definitions += req.previousIndexDefinitions.length
			if (req.requestKind === 'previousIndex:sources') sources += req.previousIndexSources.length
			if (req.requestKind !== 'done') return
			if (!startWasCompact || definitions !== 150 || sources !== 129) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'incremental previous index request was not chunked' }
				}) + '\n')
				return
			}
			const tx = 'tx-ast'
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:start',
				transactionId: tx,
				phase: 'ast',
				root,
				startedAt: new Date(0).toISOString()
			}) + '\n')
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:done',
				transactionId: tx,
				phase: 'ast',
				patch: {
					schemaVersion: 1,
					phase: 'ast',
					project: { root },
					startedAt: new Date(0).toISOString(),
					finishedAt: new Date(0).toISOString(),
					status: 'ok'
				},
				summary: {
					factCount: 0,
					decision: { kind: 'source-file-reindex' },
					report: {
						planKind: 'source-file-reindex',
						fallbackUsed: false,
						graphConfidence: 'complete-enough-for-source-closure',
						changedFiles: [],
						deletedFiles: [],
						affectedFiles: [],
						affectedDefinitionIds: [],
						staticParsedFiles: [],
						staticCacheHits: 0,
						staticCacheMisses: 0,
						semanticAnalyzedFiles: [],
						semanticCacheHits: 0,
						semanticCacheMisses: 0,
						invalidatedFiles: [],
						invalidatedDefinitionIds: [],
						durationMsByPhase: {},
						patchCounts: { ast: 1, semantic: 0, total: 1 },
						sourceProfileFileCount: 0,
						semanticStatus: 'not-requested'
					}
				}
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	definitions := make([]store.ProjectDefinition, 150)
	for i := range definitions {
		definitions[i] = store.ProjectDefinition{
			ID:       "prompt:fixture",
			Kind:     "prompt",
			Name:     "fixture",
			Fidelity: "resolved",
		}
	}
	sources := make([]store.IndexSourceFile, 129)
	for i := range sources {
		sources[i] = store.IndexSourceFile{File: filepath.Join("src", "file.ts")}
	}
	previous := store.IndexData{
		SchemaVersion: 1,
		Definitions:   definitions,
		Sources:       sources,
	}

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	result, err := worker.IndexProjectIncremental(context.Background(), t.TempDir(), "", "project", previous, []string{"src/a.ts"}, nil, "ast")
	if err != nil {
		t.Fatalf("IndexProjectIncremental error = %v", err)
	}
	if result.Report.PlanKind != "source-file-reindex" || len(result.Patches) != 1 {
		t.Fatalf("result = %+v, want one streamed incremental patch", result)
	}
}
