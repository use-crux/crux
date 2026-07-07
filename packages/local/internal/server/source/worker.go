package source

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

const sourceWorkerMaxResponseBytes = 4 * 1024 * 1024

// Worker manages source map resolution through a persistent Node worker.
type Worker struct {
	worker      *workerproc.Worker
	projectRoot string
}

// ResolveRequest is a request to resolve source locations.
type ResolveRequest struct {
	Method      string     `json:"method"`
	Locations   []Location `json:"locations,omitempty"`
	File        string     `json:"file,omitempty"`
	Line        int        `json:"line,omitempty"`
	Column      *int       `json:"column,omitempty"`
	SourceRef   string     `json:"sourceRef,omitempty"`
	FrameRadius *int       `json:"frameRadius,omitempty"`
	Role        string     `json:"role,omitempty"`
	CapturedAt  string     `json:"capturedAt,omitempty"`
	ProjectRoot string     `json:"projectRoot,omitempty"`
}

// Location is an input location to resolve.
type Location struct {
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

// ResolvedFn is a resolved function source.
type ResolvedFn struct {
	Source    string `json:"source"`
	File      string `json:"file"`
	StartLine int    `json:"startLine"`
	Resolved  bool   `json:"resolved"`
}

// FrameRequest is a request to resolve a narrow authored source frame.
type FrameRequest struct {
	File        string `json:"file"`
	Line        int    `json:"line"`
	Column      *int   `json:"column,omitempty"`
	SourceRef   string `json:"sourceRef,omitempty"`
	FrameRadius *int   `json:"frameRadius,omitempty"`
	Role        string `json:"role,omitempty"`
	CapturedAt  string `json:"capturedAt,omitempty"`
	ProjectRoot string `json:"projectRoot,omitempty"`
}

// FrameResult is the source resolver's authored-frame union shape.
type FrameResult struct {
	Kind           string      `json:"kind"`
	Reason         string      `json:"reason,omitempty"`
	SourceRef      string      `json:"sourceRef,omitempty"`
	AuthoredFile   string      `json:"authoredFile,omitempty"`
	AuthoredLine   int         `json:"authoredLine,omitempty"`
	AuthoredColumn *int        `json:"authoredColumn,omitempty"`
	FrameStartLine int         `json:"frameStartLine,omitempty"`
	FrameEndLine   int         `json:"frameEndLine,omitempty"`
	Lines          []FrameLine `json:"lines,omitempty"`
	ContentHash    string      `json:"contentHash,omitempty"`
	CapturedAt     string      `json:"capturedAt,omitempty"`
	Stale          bool        `json:"stale,omitempty"`
	Resolver       string      `json:"resolver,omitempty"`
}

// FrameLine is one line in a narrow authored source-frame snapshot.
type FrameLine struct {
	Line int    `json:"line"`
	Text string `json:"text"`
	Role string `json:"role"`
}

// New creates a source worker. When scriptPath is empty, embeddedScript is used.
func New(scriptPath string, embeddedScript []byte, projectRoot string) *Worker {
	opts := []workerproc.Option{workerproc.WithMaxResponseBytes(sourceWorkerMaxResponseBytes)}
	if scriptPath != "" {
		opts = append(opts, workerproc.WithScriptPath(scriptPath))
	}
	return &Worker{
		projectRoot: projectRoot,
		worker: workerproc.New(workerproc.Script{
			Name:    "source-resolver",
			Content: embeddedScript,
		}, opts...),
	}
}

// ResolveLocations resolves multiple source locations.
func (w *Worker) ResolveLocations(ctx context.Context, locations []Location) ([]ResolvedLocation, error) {
	resp, err := workerproc.Call[struct {
		Locations []ResolvedLocation `json:"locations"`
	}](ctx, w.worker, ResolveRequest{
		Method:      "resolveLocations",
		Locations:   locations,
		ProjectRoot: w.projectRoot,
	})
	if err != nil {
		return nil, err
	}
	return resp.Locations, nil
}

// ResolveFn resolves a function's source code.
func (w *Worker) ResolveFn(ctx context.Context, file string, line int, column *int) (*ResolvedFn, error) {
	resp, err := workerproc.Call[ResolvedFn](ctx, w.worker, ResolveRequest{
		Method:      "resolveFnSource",
		File:        file,
		Line:        line,
		Column:      column,
		ProjectRoot: w.projectRoot,
	})
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// ResolveFrame resolves a narrow authored source-frame snapshot.
func (w *Worker) ResolveFrame(ctx context.Context, req FrameRequest) (*FrameResult, error) {
	resp, err := workerproc.Call[FrameResult](ctx, w.worker, ResolveRequest{
		Method:      "resolveSourceFrame",
		File:        req.File,
		Line:        req.Line,
		Column:      req.Column,
		SourceRef:   req.SourceRef,
		FrameRadius: req.FrameRadius,
		Role:        req.Role,
		CapturedAt:  req.CapturedAt,
		ProjectRoot: firstNonEmpty(req.ProjectRoot, w.projectRoot),
	})
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// Close shuts down the worker process.
func (w *Worker) Close() error {
	if w == nil {
		return nil
	}
	return w.worker.Close()
}

func findNodePath() (string, error) {
	return workerproc.FindNodePath()
}
