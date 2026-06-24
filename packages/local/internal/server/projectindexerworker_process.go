package server

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

const projectIndexerWorkerMaxResponseBytes = 16 * 1024 * 1024

// ProjectIndexerWorkerProcess supervises a command-backed Rust/Oxc indexer
// worker through the worker JSON-lines protocol.
type ProjectIndexerWorkerProcess struct {
	worker *nodeworker.Worker
	nextID atomic.Uint64
}

// ProjectSyntaxParser is the local-runtime boundary for static syntax
// frontends. Implementations parse source text into backend-neutral Crux syntax
// records without exposing parser-native AST objects to the Go orchestrator.
type ProjectSyntaxParser interface {
	ParseFile(context.Context, ProjectSyntaxParseRequest) (json.RawMessage, error)
	Concurrency() int
	Close() error
}

// ProjectSyntaxBatchParser can parse many files through one frontend-owned
// request. Rust/Oxc indexer workers use this to keep parser scheduling inside
// the Rust process instead of fanning every file out through Go.
type ProjectSyntaxBatchParser interface {
	ParseFiles(context.Context, []ProjectSyntaxParseRequest) ([]json.RawMessage, error)
}

// ProjectSyntaxRecordHandler consumes one parsed syntax record from a streaming
// batch parse. The index is always the caller's request index, not a parser-
// internal file order.
type ProjectSyntaxRecordHandler func(index int, record json.RawMessage) error

// ProjectSyntaxBatchStreamParser can parse many files and deliver records as
// they become available. This is the preferred native path because it avoids
// accumulating all syntax records in Go before projection starts.
type ProjectSyntaxBatchStreamParser interface {
	ParseFilesStream(context.Context, []ProjectSyntaxParseRequest, ProjectSyntaxRecordHandler) error
}

// ProjectSyntaxParseRequest describes one source file to parse into a Crux
// syntax record.
type ProjectSyntaxParseRequest struct {
	Root                     string                             `json:"root"`
	File                     string                             `json:"file"`
	Source                   string                             `json:"source,omitempty"`
	ReadSourceFromDisk       bool                               `json:"readSourceFromDisk,omitempty"`
	CallNames                []string                           `json:"callNames,omitempty"`
	CallInterests            []projectSyntaxCallInterest        `json:"callInterests,omitempty"`
	ConstructorNames         []string                           `json:"constructorNames,omitempty"`
	ConstructorInterests     []projectSyntaxConstructorInterest `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                           `json:"pruneNativeFactCallNames,omitempty"`
}

type projectSyntaxCallInterest struct {
	Name       string                          `json:"name"`
	ImportFrom []string                        `json:"importFrom,omitempty"`
	ConfigArg  *int                            `json:"configArg,omitempty"`
	Properties []string                        `json:"properties,omitempty"`
	Callbacks  []projectSyntaxCallbackInterest `json:"callbacks,omitempty"`
	Source     string                          `json:"source,omitempty"`
}

type projectSyntaxConstructorInterest struct {
	Name       string                          `json:"name"`
	ImportFrom []string                        `json:"importFrom,omitempty"`
	ConfigArg  *int                            `json:"configArg,omitempty"`
	Properties []string                        `json:"properties,omitempty"`
	Callbacks  []projectSyntaxCallbackInterest `json:"callbacks,omitempty"`
	Source     string                          `json:"source,omitempty"`
}

type projectSyntaxCallbackInterest struct {
	Property string `json:"property"`
	MaxDepth *int   `json:"maxDepth,omitempty"`
}

type projectIndexerWorkerSyntaxRequest struct {
	ID uint64 `json:"id"`
	ProjectSyntaxParseRequest
}

type projectIndexerWorkerSyntaxBatchRequest struct {
	ID                       uint64                                `json:"id"`
	Files                    []projectIndexerWorkerSyntaxBatchFile `json:"files"`
	CallNames                []string                              `json:"callNames,omitempty"`
	CallInterests            []projectSyntaxCallInterest           `json:"callInterests,omitempty"`
	ConstructorNames         []string                              `json:"constructorNames,omitempty"`
	ConstructorInterests     []projectSyntaxConstructorInterest    `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                              `json:"pruneNativeFactCallNames,omitempty"`
	Stream                   bool                                  `json:"stream,omitempty"`
}

type projectIndexerWorkerSyntaxBatchFile struct {
	Root               string `json:"root"`
	File               string `json:"file"`
	Source             string `json:"source,omitempty"`
	ReadSourceFromDisk bool   `json:"readSourceFromDisk,omitempty"`
}

type projectIndexerWorkerSyntaxResponse struct {
	ID      uint64            `json:"id"`
	OK      bool              `json:"ok"`
	Record  json.RawMessage   `json:"record"`
	Records []json.RawMessage `json:"records"`
	Error   string            `json:"error,omitempty"`
}

type projectIndexerWorkerSyntaxBatchEvent struct {
	ID     uint64          `json:"id"`
	Type   string          `json:"type"`
	Index  int             `json:"index,omitempty"`
	Count  int             `json:"count,omitempty"`
	Record json.RawMessage `json:"record,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// NewProjectIndexerWorkerProcess creates a command-backed indexer worker.
func NewProjectIndexerWorkerProcess(commandPath string, commandArgs ...string) *ProjectIndexerWorkerProcess {
	return &ProjectIndexerWorkerProcess{
		worker: nodeworker.New(
			nodeworker.Script{Name: "project-indexer-worker"},
			nodeworker.WithCommand(commandPath, commandArgs...),
			nodeworker.WithMaxResponseBytes(projectIndexerWorkerMaxResponseBytes),
		),
	}
}

// ParseFile sends a single parse request and returns the raw syntax record.
func (w *ProjectIndexerWorkerProcess) ParseFile(ctx context.Context, request ProjectSyntaxParseRequest) (json.RawMessage, error) {
	if w == nil || w.worker == nil {
		return nil, fmt.Errorf("project indexer worker is not configured")
	}
	id := w.nextID.Add(1)
	response, err := nodeworker.Call[projectIndexerWorkerSyntaxResponse](ctx, w.worker, projectIndexerWorkerSyntaxRequest{
		ID:                        id,
		ProjectSyntaxParseRequest: request,
	})
	if err != nil {
		return nil, err
	}
	if response.ID != id {
		w.worker.Close()
		return nil, fmt.Errorf("project indexer worker response id %d, want %d", response.ID, id)
	}
	if !response.OK {
		if response.Error == "" {
			return nil, fmt.Errorf("project indexer worker failed")
		}
		return nil, fmt.Errorf("project indexer worker failed: %s", response.Error)
	}
	if len(response.Record) == 0 {
		return nil, fmt.Errorf("project indexer worker returned empty record")
	}
	return response.Record, nil
}

// ParseFiles sends a batch parse request and returns raw syntax records in the
// same order as the input requests.
func (w *ProjectIndexerWorkerProcess) ParseFiles(ctx context.Context, requests []ProjectSyntaxParseRequest) ([]json.RawMessage, error) {
	if w == nil || w.worker == nil {
		return nil, fmt.Errorf("project indexer worker is not configured")
	}
	if len(requests) == 0 {
		return []json.RawMessage{}, nil
	}
	records := make([]json.RawMessage, len(requests))
	if err := w.ParseFilesStream(ctx, requests, func(index int, record json.RawMessage) error {
		records[index] = record
		return nil
	}); err != nil {
		return nil, err
	}
	return records, nil
}

// ParseFilesStream sends a streaming batch parse request and calls handle for
// each record as soon as the native frontend emits it.
func (w *ProjectIndexerWorkerProcess) ParseFilesStream(ctx context.Context, requests []ProjectSyntaxParseRequest, handle ProjectSyntaxRecordHandler) error {
	if w == nil || w.worker == nil {
		return fmt.Errorf("project indexer worker is not configured")
	}
	if handle == nil {
		return fmt.Errorf("project indexer worker stream handler is not configured")
	}
	if len(requests) == 0 {
		return nil
	}
	id := w.nextID.Add(1)
	seen := make([]bool, len(requests))
	received := 0
	return nodeworker.StreamCall(ctx, w.worker, projectIndexerWorkerSyntaxBatchRequest{
		ID:                       id,
		Files:                    projectIndexerWorkerSyntaxBatchFiles(requests),
		CallNames:                requests[0].CallNames,
		CallInterests:            requests[0].CallInterests,
		ConstructorNames:         requests[0].ConstructorNames,
		ConstructorInterests:     requests[0].ConstructorInterests,
		PruneNativeFactCallNames: requests[0].PruneNativeFactCallNames,
		Stream:                   true,
	}, func(raw json.RawMessage) (bool, error) {
		event, err := decodeProjectIndexerWorkerSyntaxBatchEvent(raw)
		if err != nil {
			return false, fmt.Errorf("decode project indexer worker syntax stream event: %w", err)
		}
		if event.ID != id {
			return false, fmt.Errorf("project indexer worker response id %d, want %d", event.ID, id)
		}
		switch event.Type {
		case "record":
			if event.Index < 0 || event.Index >= len(requests) {
				return false, fmt.Errorf("project indexer worker returned record index %d, want 0-%d", event.Index, len(requests)-1)
			}
			if seen[event.Index] {
				return false, fmt.Errorf("project indexer worker returned duplicate record index %d", event.Index)
			}
			if len(event.Record) == 0 {
				return false, fmt.Errorf("project indexer worker returned empty record at index %d", event.Index)
			}
			if err := handle(event.Index, event.Record); err != nil {
				return false, err
			}
			seen[event.Index] = true
			received++
			return false, nil
		case "error":
			if event.Error == "" {
				return false, fmt.Errorf("project indexer worker failed")
			}
			return false, fmt.Errorf("project indexer worker failed: %s", event.Error)
		case "done":
			if event.Count != len(requests) {
				return false, fmt.Errorf("project indexer worker syntax stream completed with %d records, want %d", event.Count, len(requests))
			}
			if received != len(requests) {
				return false, fmt.Errorf("project indexer worker syntax stream delivered %d records, want %d", received, len(requests))
			}
			for index, ok := range seen {
				if !ok {
					return false, fmt.Errorf("project indexer worker syntax stream missing record at index %d", index)
				}
			}
			return true, nil
		default:
			return false, fmt.Errorf("project indexer worker returned unknown stream event type %q", event.Type)
		}
	})
}

// Concurrency reports the number of concurrent parse requests this worker can
// execute without serializing on one subprocess pipe.
func (w *ProjectIndexerWorkerProcess) Concurrency() int {
	if w == nil || w.worker == nil {
		return 0
	}
	return 1
}

// Close shuts down the indexer worker process.
func (w *ProjectIndexerWorkerProcess) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
}

func projectIndexerWorkerSyntaxBatchFiles(requests []ProjectSyntaxParseRequest) []projectIndexerWorkerSyntaxBatchFile {
	files := make([]projectIndexerWorkerSyntaxBatchFile, 0, len(requests))
	for _, request := range requests {
		files = append(files, projectIndexerWorkerSyntaxBatchFile{
			Root:               request.Root,
			File:               request.File,
			Source:             request.Source,
			ReadSourceFromDisk: request.ReadSourceFromDisk,
		})
	}
	return files
}
