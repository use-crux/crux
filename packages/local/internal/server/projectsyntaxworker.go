package server

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

const projectSyntaxWorkerMaxResponseBytes = 16 * 1024 * 1024

// ProjectSyntaxWorker supervises a native static syntax worker through the
// Rust/Oxc JSON-lines protocol.
type ProjectSyntaxWorker struct {
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
// request. Native syntax workers use this to keep parser scheduling inside the
// Rust process instead of fanning every file out through Go.
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

type projectSyntaxWorkerRequest struct {
	ID uint64 `json:"id"`
	ProjectSyntaxParseRequest
}

type projectSyntaxWorkerBatchRequest struct {
	ID                       uint64                             `json:"id"`
	Files                    []projectSyntaxWorkerBatchFile     `json:"files"`
	CallNames                []string                           `json:"callNames,omitempty"`
	CallInterests            []projectSyntaxCallInterest        `json:"callInterests,omitempty"`
	ConstructorNames         []string                           `json:"constructorNames,omitempty"`
	ConstructorInterests     []projectSyntaxConstructorInterest `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                           `json:"pruneNativeFactCallNames,omitempty"`
	Stream                   bool                               `json:"stream,omitempty"`
}

type projectSyntaxWorkerBatchFile struct {
	Root               string `json:"root"`
	File               string `json:"file"`
	Source             string `json:"source,omitempty"`
	ReadSourceFromDisk bool   `json:"readSourceFromDisk,omitempty"`
}

type projectSyntaxWorkerResponse struct {
	ID      uint64            `json:"id"`
	OK      bool              `json:"ok"`
	Record  json.RawMessage   `json:"record"`
	Records []json.RawMessage `json:"records"`
	Error   string            `json:"error,omitempty"`
}

type projectSyntaxWorkerBatchEvent struct {
	ID     uint64          `json:"id"`
	Type   string          `json:"type"`
	Index  int             `json:"index,omitempty"`
	Count  int             `json:"count,omitempty"`
	Record json.RawMessage `json:"record,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// NewProjectSyntaxWorker creates a command-backed syntax worker.
func NewProjectSyntaxWorker(commandPath string, commandArgs ...string) *ProjectSyntaxWorker {
	return &ProjectSyntaxWorker{
		worker: nodeworker.New(
			nodeworker.Script{Name: "project-syntax"},
			nodeworker.WithCommand(commandPath, commandArgs...),
			nodeworker.WithMaxResponseBytes(projectSyntaxWorkerMaxResponseBytes),
		),
	}
}

// ParseFile sends a single parse request and returns the raw syntax record.
func (w *ProjectSyntaxWorker) ParseFile(ctx context.Context, request ProjectSyntaxParseRequest) (json.RawMessage, error) {
	if w == nil || w.worker == nil {
		return nil, fmt.Errorf("project syntax worker is not configured")
	}
	id := w.nextID.Add(1)
	response, err := nodeworker.Call[projectSyntaxWorkerResponse](ctx, w.worker, projectSyntaxWorkerRequest{
		ID:                        id,
		ProjectSyntaxParseRequest: request,
	})
	if err != nil {
		return nil, err
	}
	if response.ID != id {
		w.worker.Close()
		return nil, fmt.Errorf("project syntax worker response id %d, want %d", response.ID, id)
	}
	if !response.OK {
		if response.Error == "" {
			return nil, fmt.Errorf("project syntax worker failed")
		}
		return nil, fmt.Errorf("project syntax worker failed: %s", response.Error)
	}
	if len(response.Record) == 0 {
		return nil, fmt.Errorf("project syntax worker returned empty record")
	}
	return response.Record, nil
}

// ParseFiles sends a batch parse request and returns raw syntax records in the
// same order as the input requests.
func (w *ProjectSyntaxWorker) ParseFiles(ctx context.Context, requests []ProjectSyntaxParseRequest) ([]json.RawMessage, error) {
	if w == nil || w.worker == nil {
		return nil, fmt.Errorf("project syntax worker is not configured")
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
func (w *ProjectSyntaxWorker) ParseFilesStream(ctx context.Context, requests []ProjectSyntaxParseRequest, handle ProjectSyntaxRecordHandler) error {
	if w == nil || w.worker == nil {
		return fmt.Errorf("project syntax worker is not configured")
	}
	if handle == nil {
		return fmt.Errorf("project syntax worker stream handler is not configured")
	}
	if len(requests) == 0 {
		return nil
	}
	id := w.nextID.Add(1)
	seen := make([]bool, len(requests))
	received := 0
	return nodeworker.StreamCall(ctx, w.worker, projectSyntaxWorkerBatchRequest{
		ID:                       id,
		Files:                    projectSyntaxWorkerBatchFiles(requests),
		CallNames:                requests[0].CallNames,
		CallInterests:            requests[0].CallInterests,
		ConstructorNames:         requests[0].ConstructorNames,
		ConstructorInterests:     requests[0].ConstructorInterests,
		PruneNativeFactCallNames: requests[0].PruneNativeFactCallNames,
		Stream:                   true,
	}, func(raw json.RawMessage) (bool, error) {
		event, err := decodeProjectSyntaxWorkerBatchEvent(raw)
		if err != nil {
			return false, fmt.Errorf("decode project syntax worker stream event: %w", err)
		}
		if event.ID != id {
			return false, fmt.Errorf("project syntax worker response id %d, want %d", event.ID, id)
		}
		switch event.Type {
		case "record":
			if event.Index < 0 || event.Index >= len(requests) {
				return false, fmt.Errorf("project syntax worker returned record index %d, want 0-%d", event.Index, len(requests)-1)
			}
			if seen[event.Index] {
				return false, fmt.Errorf("project syntax worker returned duplicate record index %d", event.Index)
			}
			if len(event.Record) == 0 {
				return false, fmt.Errorf("project syntax worker returned empty record at index %d", event.Index)
			}
			if err := handle(event.Index, event.Record); err != nil {
				return false, err
			}
			seen[event.Index] = true
			received++
			return false, nil
		case "error":
			if event.Error == "" {
				return false, fmt.Errorf("project syntax worker failed")
			}
			return false, fmt.Errorf("project syntax worker failed: %s", event.Error)
		case "done":
			if event.Count != len(requests) {
				return false, fmt.Errorf("project syntax worker stream completed with %d records, want %d", event.Count, len(requests))
			}
			if received != len(requests) {
				return false, fmt.Errorf("project syntax worker stream delivered %d records, want %d", received, len(requests))
			}
			for index, ok := range seen {
				if !ok {
					return false, fmt.Errorf("project syntax worker stream missing record at index %d", index)
				}
			}
			return true, nil
		default:
			return false, fmt.Errorf("project syntax worker returned unknown stream event type %q", event.Type)
		}
	})
}

// Concurrency reports the number of concurrent parse requests this worker can
// execute without serializing on one subprocess pipe.
func (w *ProjectSyntaxWorker) Concurrency() int {
	if w == nil || w.worker == nil {
		return 0
	}
	return 1
}

// Close shuts down the syntax worker process.
func (w *ProjectSyntaxWorker) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
}

func projectSyntaxWorkerBatchFiles(requests []ProjectSyntaxParseRequest) []projectSyntaxWorkerBatchFile {
	files := make([]projectSyntaxWorkerBatchFile, 0, len(requests))
	for _, request := range requests {
		files = append(files, projectSyntaxWorkerBatchFile{
			Root:               request.Root,
			File:               request.File,
			Source:             request.Source,
			ReadSourceFromDisk: request.ReadSourceFromDisk,
		})
	}
	return files
}
