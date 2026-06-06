package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// SourceWorker manages a lazy-spawned Node.js subprocess for source map resolution.
// Communication is JSON-RPC over stdin/stdout.
type SourceWorker struct {
	mu         sync.Mutex
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     *bufio.Reader
	spawned    bool
	scriptPath string
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

type sourceWorkerScanResult struct {
	bytes []byte
	err   error
}

const sourceWorkerMaxResponseBytes = 4 * 1024 * 1024

// NewSourceWorker creates a new source worker that will spawn Node.js lazily.
// scriptPath should be the path to the extracted source-resolver.mjs.
func NewSourceWorker(scriptPath string) *SourceWorker {
	return &SourceWorker{
		scriptPath: scriptPath,
	}
}

// ensureSpawned starts the Node.js worker if not already running.
// Must be called with mu held.
func (w *SourceWorker) ensureSpawned() error {
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
		return fmt.Errorf("start worker: %w", err)
	}

	w.spawned = true
	slog.Info("source resolver worker started", "pid", w.cmd.Process.Pid, "node", nodePath, "nodeVersion", nodeVersion(nodePath))
	return nil
}

// call sends a JSON-RPC request and reads a JSON response.
func (w *SourceWorker) call(req any) (json.RawMessage, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.ensureSpawned(); err != nil {
		return nil, err
	}

	// Write request as single JSON line
	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	data = append(data, '\n')
	if _, err := w.stdin.Write(data); err != nil {
		return nil, fmt.Errorf("write to worker: %w", err)
	}

	stdout := w.stdout
	if stdout == nil {
		return nil, fmt.Errorf("source resolver worker stdout unavailable")
	}

	result := scanSourceWorkerLine(stdout, sourceWorkerMaxResponseBytes)
	if result.err != nil {
		w.killLocked()
		return nil, result.err
	}
	return json.RawMessage(result.bytes), nil
}

func scanSourceWorkerLine(stdout *bufio.Reader, maxBytes int) sourceWorkerScanResult {
	if stdout == nil {
		return sourceWorkerScanResult{err: fmt.Errorf("source resolver worker stdout unavailable")}
	}
	var line []byte
	for {
		chunk, err := stdout.ReadSlice('\n')
		line = append(line, chunk...)
		if maxBytes > 0 && len(line) > maxBytes {
			return sourceWorkerScanResult{err: fmt.Errorf("source resolver worker response exceeded %d bytes", maxBytes)}
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) && len(line) == 0 {
			return sourceWorkerScanResult{err: fmt.Errorf("source resolver worker: no output (EOF)")}
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return sourceWorkerScanResult{err: fmt.Errorf("read from source resolver worker: %w", err)}
		}
		break
	}
	line = bytes.TrimSuffix(line, []byte("\n"))
	line = bytes.TrimSuffix(line, []byte("\r"))
	return sourceWorkerScanResult{bytes: line}
}

// ResolveLocations resolves multiple source locations.
func (w *SourceWorker) ResolveLocations(locations []SourceLocation) ([]ResolvedLocation, error) {
	resp, err := w.call(SourceResolveRequest{
		Method:    "resolveLocations",
		Locations: locations,
	})
	if err != nil {
		return nil, err
	}

	var result struct {
		Locations []ResolvedLocation `json:"locations"`
		Error     string             `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}
	if result.Error != "" {
		return nil, fmt.Errorf("source resolver worker: %s", result.Error)
	}
	return result.Locations, nil
}

// ResolveFnSource resolves a function's source code.
func (w *SourceWorker) ResolveFnSource(file string, line int, column *int) (*ResolvedFnSource, error) {
	resp, err := w.call(SourceResolveRequest{
		Method: "resolveFnSource",
		File:   file,
		Line:   line,
		Column: column,
	})
	if err != nil {
		return nil, err
	}

	var result ResolvedFnSource
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}
	var errorResult struct {
		Error string `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &errorResult); err == nil && errorResult.Error != "" {
		return nil, fmt.Errorf("source resolver worker: %s", errorResult.Error)
	}
	return &result, nil
}

// Close shuts down the worker process.
func (w *SourceWorker) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.spawned || w.cmd == nil || w.cmd.Process == nil {
		return nil
	}

	slog.Info("stopping source resolver worker")
	if w.stdin != nil {
		_ = w.stdin.Close()
	}
	err := w.cmd.Wait()
	w.spawned = false
	return err
}

func (w *SourceWorker) killLocked() {
	if !w.spawned || w.cmd == nil || w.cmd.Process == nil {
		return
	}
	slog.Warn("stopping source resolver worker after request failure")
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

// findNodePath locates a Node.js binary that can run the embedded workers.
func findNodePath() (string, error) {
	candidates := candidateNodePaths()
	for _, candidate := range candidates {
		if nodeMajorVersion(candidate) >= 24 {
			return candidate, nil
		}
	}
	if len(candidates) > 0 {
		return "", fmt.Errorf("Node.js >= 24 not found; first candidate %s is %s", candidates[0], nodeVersion(candidates[0]))
	}
	return "", fmt.Errorf("Node.js >= 24 not found in PATH or nvm installs")
}

func candidateNodePaths() []string {
	var candidates []string
	seen := map[string]struct{}{}
	add := func(path string) {
		if path == "" {
			return
		}
		resolved, err := exec.LookPath(path)
		if err != nil {
			if _, statErr := os.Stat(path); statErr != nil {
				return
			}
			resolved = path
		}
		if _, ok := seen[resolved]; ok {
			return
		}
		seen[resolved] = struct{}{}
		candidates = append(candidates, resolved)
	}

	add(os.Getenv("CRUX_NODE_PATH"))
	add(filepath.Join(os.Getenv("NVM_BIN"), "node"))
	add("node")

	if runtime.GOOS == "windows" {
		add(filepath.Join(os.Getenv("ProgramFiles"), "nodejs", "node.exe"))
		add(filepath.Join(os.Getenv("LOCALAPPDATA"), "fnm_multishells", "node.exe"))
	}

	if home, err := os.UserHomeDir(); err == nil {
		nvmRoot := filepath.Join(home, ".nvm", "versions", "node")
		if entries, err := os.ReadDir(nvmRoot); err == nil {
			var versions []string
			for _, entry := range entries {
				if entry.IsDir() {
					versions = append(versions, entry.Name())
				}
			}
			sort.Slice(versions, func(i, j int) bool {
				return compareNodeVersionDirs(versions[i], versions[j]) > 0
			})
			for _, version := range versions {
				add(filepath.Join(nvmRoot, version, "bin", "node"))
			}
		}
	}

	return candidates
}

func nodeMajorVersion(path string) int {
	version := nodeVersion(path)
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	major, _, _ := strings.Cut(version, ".")
	value, err := strconv.Atoi(major)
	if err != nil {
		return 0
	}
	return value
}

func nodeVersion(path string) string {
	output, err := exec.Command(path, "--version").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(output))
}

func compareNodeVersionDirs(a, b string) int {
	partsA := nodeVersionParts(a)
	partsB := nodeVersionParts(b)
	for i := 0; i < len(partsA) && i < len(partsB); i++ {
		if partsA[i] > partsB[i] {
			return 1
		}
		if partsA[i] < partsB[i] {
			return -1
		}
	}
	return 0
}

func nodeVersionParts(version string) [3]int {
	version = strings.TrimPrefix(version, "v")
	parts := strings.Split(version, ".")
	var parsed [3]int
	for i := 0; i < len(parts) && i < len(parsed); i++ {
		value, err := strconv.Atoi(parts[i])
		if err == nil {
			parsed[i] = value
		}
	}
	return parsed
}
