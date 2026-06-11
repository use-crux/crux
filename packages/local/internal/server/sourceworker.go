package server

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

const sourceWorkerMaxResponseBytes = 4 * 1024 * 1024

// SourceWorker manages source map resolution through a persistent Node worker.
type SourceWorker struct {
	worker *nodeworker.Worker
}

// SourceResolveRequest is a request to resolve source locations.
type SourceResolveRequest struct {
	Method    string           `json:"method"`
	Locations []SourceLocation `json:"locations,omitempty"`
	File      string           `json:"file,omitempty"`
	Line      int              `json:"line,omitempty"`
	Column    *int             `json:"column,omitempty"`
}

// SourceLocation is an input location to resolve.
type SourceLocation struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   *int   `json:"column,omitempty"`
	Function string `json:"function,omitempty"`
}

// ResolvedLocation is a resolved source location.
type ResolvedLocation struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   *int   `json:"column,omitempty"`
	Function string `json:"function,omitempty"`
	Resolved bool   `json:"resolved"`
}

// ResolvedFnSource is a resolved function source.
type ResolvedFnSource struct {
	Source    string `json:"source"`
	File      string `json:"file"`
	StartLine int    `json:"startLine"`
	Resolved  bool   `json:"resolved"`
}

// NewSourceWorker creates a new source worker. When scriptPath is empty, the
// embedded source resolver is extracted lazily on first use.
func NewSourceWorker(scriptPath string) *SourceWorker {
	opts := []nodeworker.Option{nodeworker.WithMaxResponseBytes(sourceWorkerMaxResponseBytes)}
	if scriptPath != "" {
		opts = append(opts, nodeworker.WithScriptPath(scriptPath))
	}
	return &SourceWorker{
		worker: nodeworker.New(nodeworker.Script{
			Name:    "source-resolver",
			Content: embeddedSourceResolver,
		}, opts...),
	}
}

// ResolveLocations resolves multiple source locations.
func (w *SourceWorker) ResolveLocations(ctx context.Context, locations []SourceLocation) ([]ResolvedLocation, error) {
	resp, err := nodeworker.Call[struct {
		Locations []ResolvedLocation `json:"locations"`
	}](ctx, w.worker, SourceResolveRequest{
		Method:    "resolveLocations",
		Locations: locations,
	})
	if err != nil {
		return nil, err
	}
	return resp.Locations, nil
}

// ResolveFnSource resolves a function's source code.
func (w *SourceWorker) ResolveFnSource(ctx context.Context, file string, line int, column *int) (*ResolvedFnSource, error) {
	resp, err := nodeworker.Call[ResolvedFnSource](ctx, w.worker, SourceResolveRequest{
		Method: "resolveFnSource",
		File:   file,
		Line:   line,
		Column: column,
	})
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// Close shuts down the worker process.
func (w *SourceWorker) Close() error {
	if w == nil {
		return nil
	}
	return w.worker.Close()
}

func findNodePath() (string, error) {
	return nodeworker.FindNodePath()
}
