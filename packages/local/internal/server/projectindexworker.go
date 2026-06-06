package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ProjectIndexWorker manages a lazy Node.js subprocess for Project Catalog indexing.
type ProjectIndexWorker struct {
	mu         sync.Mutex
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     *bufio.Reader
	spawned    bool
	scriptPath string
}

type projectIndexRequest struct {
	Method           string                       `json:"method"`
	Root             string                       `json:"root"`
	ConfigPath       string                       `json:"configPath,omitempty"`
	ProjectName      string                       `json:"projectName,omitempty"`
	StaticOnly       bool                         `json:"staticOnly,omitempty"`
	SemanticBudget   *devtools.CatalogPatchBudget `json:"semanticBudget,omitempty"`
	PreviousCatalog  *store.CatalogData           `json:"previousCatalog,omitempty"`
	Files            []string                     `json:"files,omitempty"`
	DeletedFiles     []string                     `json:"deletedFiles,omitempty"`
	Mode             string                       `json:"mode,omitempty"`
	MaxAffectedFiles int                          `json:"maxAffectedFiles,omitempty"`
}

type projectIndexScanResult struct {
	bytes []byte
	err   error
}

const projectIndexStaticFallbackTimeout = 30 * time.Second
const projectIndexWorkerMaxResponseBytes = 16 * 1024 * 1024

// NewProjectIndexWorker creates a worker backed by project-indexer.mjs.
func NewProjectIndexWorker(scriptPath string) *ProjectIndexWorker {
	return &ProjectIndexWorker{scriptPath: scriptPath}
}

// IndexProject returns a canonical Project Catalog snapshot for root.
func (w *ProjectIndexWorker) IndexProject(ctx context.Context, root, configPath, projectName string) (store.CatalogData, error) {
	req := projectIndexRequest{
		Method:      "indexProject",
		Root:        root,
		ConfigPath:  configPath,
		ProjectName: projectName,
	}
	resp, err := w.call(ctx, req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return store.CatalogData{}, err
		}
		resp, err = w.staticFallback(ctx, req, err)
		if err != nil {
			return store.CatalogData{}, err
		}
	}

	var result struct {
		Snapshot store.CatalogData `json:"snapshot"`
		Error    string            `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return store.CatalogData{}, fmt.Errorf("unmarshal project index response: %w", err)
	}
	if result.Error != "" {
		return store.CatalogData{}, fmt.Errorf("project index worker: %s", result.Error)
	}
	return result.Snapshot, nil
}

func (w *ProjectIndexWorker) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (devtools.CatalogPatch, error) {
	req := projectIndexRequest{
		Method:      "indexProjectAst",
		Root:        root,
		ConfigPath:  configPath,
		ProjectName: projectName,
		StaticOnly:  staticOnly,
	}
	resp, err := w.call(ctx, req)
	if err != nil {
		return devtools.CatalogPatch{}, err
	}

	var result struct {
		Patch devtools.CatalogPatch `json:"patch"`
		Error string                `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return devtools.CatalogPatch{}, fmt.Errorf("unmarshal project ast response: %w", err)
	}
	if result.Error != "" {
		return devtools.CatalogPatch{}, fmt.Errorf("project ast worker: %s", result.Error)
	}
	return result.Patch, nil
}

func (w *ProjectIndexWorker) IndexProjectSemanticPatch(ctx context.Context, root, configPath, projectName string, budget devtools.CatalogPatchBudget) (devtools.CatalogPatch, error) {
	req := projectIndexRequest{
		Method:         "indexProjectSemantic",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		SemanticBudget: &budget,
	}
	resp, err := w.call(ctx, req)
	if err != nil {
		return devtools.CatalogPatch{}, err
	}

	var result struct {
		Patch devtools.CatalogPatch `json:"patch"`
		Error string                `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return devtools.CatalogPatch{}, fmt.Errorf("unmarshal project semantic response: %w", err)
	}
	if result.Error != "" {
		return devtools.CatalogPatch{}, fmt.Errorf("project semantic worker: %s", result.Error)
	}
	return result.Patch, nil
}

func (w *ProjectIndexWorker) IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousCatalog store.CatalogData, files []string, deletedFiles []string, mode string) (devtools.ProjectIndexIncrementalResult, error) {
	if mode == "" {
		mode = "ast-and-semantic"
	}
	req := projectIndexRequest{
		Method:          "indexProjectIncremental",
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		PreviousCatalog: &previousCatalog,
		Files:           files,
		DeletedFiles:    deletedFiles,
		Mode:            mode,
	}
	resp, err := w.call(ctx, req)
	if err != nil {
		return devtools.ProjectIndexIncrementalResult{}, err
	}

	var result struct {
		Decision map[string]any                         `json:"decision"`
		Patches  []devtools.CatalogPatch                `json:"patches"`
		Report   devtools.ProjectIndexIncrementalReport `json:"report"`
		Error    string                                 `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return devtools.ProjectIndexIncrementalResult{}, fmt.Errorf("unmarshal project incremental response: %w", err)
	}
	if result.Error != "" {
		return devtools.ProjectIndexIncrementalResult{}, fmt.Errorf("project incremental worker: %s", result.Error)
	}
	return devtools.ProjectIndexIncrementalResult{
		Decision: result.Decision,
		Patches:  result.Patches,
		Report:   result.Report,
	}, nil
}

func (w *ProjectIndexWorker) staticFallback(ctx context.Context, req projectIndexRequest, cause error) (json.RawMessage, error) {
	timeout := projectIndexStaticFallbackTimeout
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining < 0 {
			remaining = 0
		}
		if remaining < timeout {
			timeout = remaining
		}
	}

	fallbackCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req.StaticOnly = true
	resp, err := w.call(fallbackCtx, req)
	if err != nil {
		return nil, fmt.Errorf("project index static fallback after worker failure (%s): %w", cause.Error(), err)
	}
	return resp, nil
}

func (w *ProjectIndexWorker) ensureSpawned() error {
	if w.spawned {
		return nil
	}
	nodePath, err := findNodePath()
	if err != nil {
		return fmt.Errorf("node not found: %w", err)
	}

	w.cmd = exec.Command(nodePath, w.scriptPath)
	w.cmd.Stderr = os.Stderr

	stdin, err := w.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}
	w.stdin = stdin

	stdout, err := w.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	w.stdout = bufio.NewReaderSize(stdout, 64*1024)

	if err := w.cmd.Start(); err != nil {
		return fmt.Errorf("start project index worker: %w", err)
	}

	w.spawned = true
	slog.Info("project index worker started", "pid", w.cmd.Process.Pid, "node", nodePath, "nodeVersion", nodeVersion(nodePath))
	return nil
}

func (w *ProjectIndexWorker) call(ctx context.Context, req any) (json.RawMessage, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := w.ensureSpawned(); err != nil {
		return nil, err
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal project index request: %w", err)
	}
	data = append(data, '\n')
	if _, err := w.stdin.Write(data); err != nil {
		return nil, fmt.Errorf("write to project index worker: %w", err)
	}

	stdout := w.stdout
	if stdout == nil {
		return nil, fmt.Errorf("project index worker stdout unavailable")
	}

	resultCh := make(chan projectIndexScanResult, 1)
	go func(stdout *bufio.Reader) {
		resultCh <- scanProjectIndexWorkerLine(stdout, projectIndexWorkerMaxResponseBytes)
	}(stdout)

	select {
	case <-ctx.Done():
		err := ctx.Err()
		w.killLocked()
		return nil, err
	case result := <-resultCh:
		if result.err != nil {
			w.killLocked()
			return nil, result.err
		}
		return json.RawMessage(result.bytes), nil
	}
}

func scanProjectIndexWorkerLine(stdout *bufio.Reader, maxBytes int) projectIndexScanResult {
	if stdout == nil {
		return projectIndexScanResult{err: fmt.Errorf("project index worker stdout unavailable")}
	}
	var line []byte
	for {
		chunk, err := stdout.ReadSlice('\n')
		line = append(line, chunk...)
		if maxBytes > 0 && len(line) > maxBytes {
			return projectIndexScanResult{err: fmt.Errorf("project index worker response exceeded %d bytes", maxBytes)}
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) && len(line) == 0 {
			return projectIndexScanResult{err: fmt.Errorf("project index worker: no output (EOF)")}
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return projectIndexScanResult{err: fmt.Errorf("read from project index worker: %w", err)}
		}
		break
	}
	line = bytes.TrimSuffix(line, []byte("\n"))
	line = bytes.TrimSuffix(line, []byte("\r"))
	return projectIndexScanResult{bytes: line}
}

// Close shuts down the worker process.
func (w *ProjectIndexWorker) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.spawned || w.cmd == nil || w.cmd.Process == nil {
		return nil
	}
	slog.Info("stopping project index worker")
	if w.stdin != nil {
		_ = w.stdin.Close()
	}
	err := w.cmd.Wait()
	w.spawned = false
	return err
}

func (w *ProjectIndexWorker) killLocked() {
	if !w.spawned || w.cmd == nil || w.cmd.Process == nil {
		return
	}
	slog.Warn("stopping project index worker after request failure")
	_ = w.cmd.Process.Kill()
	if w.stdin != nil {
		_ = w.stdin.Close()
	}
	_ = w.cmd.Wait()
	w.spawned = false
	w.cmd = nil
	w.stdin = nil
	w.stdout = nil
}
