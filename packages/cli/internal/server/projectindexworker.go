package server

import (
	"bufio"
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

	"github.com/use-crux/crux/packages/cli/internal/store"
)

// ProjectIndexWorker manages a lazy Node.js subprocess for Project Catalog indexing.
type ProjectIndexWorker struct {
	mu         sync.Mutex
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	scanner    *bufio.Scanner
	spawned    bool
	scriptPath string
}

type projectIndexRequest struct {
	Method      string `json:"method"`
	Root        string `json:"root"`
	ConfigPath  string `json:"configPath,omitempty"`
	ProjectName string `json:"projectName,omitempty"`
	StaticOnly  bool   `json:"staticOnly,omitempty"`
}

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
		if errors.Is(err, context.DeadlineExceeded) {
			fallbackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			req.StaticOnly = true
			resp, err = w.call(fallbackCtx, req)
			if err != nil {
				return store.CatalogData{}, fmt.Errorf("project index static fallback after timeout: %w", err)
			}
		} else {
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
	w.scanner = bufio.NewScanner(stdout)
	w.scanner.Buffer(make([]byte, 1024*1024), 8*1024*1024)

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

	type scanResult struct {
		bytes []byte
		err   error
	}
	resultCh := make(chan scanResult, 1)
	go func() {
		if !w.scanner.Scan() {
			if err := w.scanner.Err(); err != nil {
				resultCh <- scanResult{err: fmt.Errorf("read from project index worker: %w", err)}
				return
			}
			resultCh <- scanResult{err: fmt.Errorf("project index worker closed stdout")}
			return
		}
		line := append([]byte(nil), w.scanner.Bytes()...)
		resultCh <- scanResult{bytes: line}
	}()

	select {
	case <-ctx.Done():
		err := ctx.Err()
		w.killLocked()
		return nil, err
	case result := <-resultCh:
		if result.err != nil {
			return nil, result.err
		}
		return json.RawMessage(result.bytes), nil
	}
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
	slog.Warn("killing project index worker after context cancellation")
	_ = w.cmd.Process.Kill()
	if w.stdin != nil {
		_ = w.stdin.Close()
	}
	_ = w.cmd.Wait()
	w.spawned = false
	w.cmd = nil
	w.stdin = nil
	w.scanner = nil
}
