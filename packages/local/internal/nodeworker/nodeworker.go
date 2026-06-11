package nodeworker

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
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

const (
	defaultMaxResponseBytes = 16 * 1024 * 1024
	stdoutBufferBytes       = 64 * 1024
)

// Script identifies an embedded Node.js worker script.
type Script struct {
	Name    string
	Content []byte
}

type config struct {
	maxResponseBytes int
	nodeResolver     func() (string, error)
	commandPath      string
	commandArgs      []string
	scriptPath       string
}

// Option configures a Worker.
type Option func(*config)

// WithMaxResponseBytes configures the maximum single JSON-line response size.
func WithMaxResponseBytes(n int) Option {
	return func(c *config) {
		c.maxResponseBytes = n
	}
}

// WithNodeResolver configures how Node.js is discovered.
func WithNodeResolver(f func() (string, error)) Option {
	return func(c *config) {
		c.nodeResolver = f
	}
}

// WithCommand runs this executable directly, bypassing Node discovery and
// embedded script extraction. It is intended for subprocess boundary tests.
func WithCommand(path string, args ...string) Option {
	return func(c *config) {
		c.commandPath = path
		c.commandArgs = append([]string(nil), args...)
	}
}

// WithScriptPath runs an already-extracted script path through the configured
// Node resolver. This preserves existing server construction seams.
func WithScriptPath(path string) Option {
	return func(c *config) {
		c.scriptPath = path
	}
}

// Worker is a lazy, persistent JSON-line Node subprocess.
type Worker struct {
	mu      sync.Mutex
	script  Script
	config  config
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  *bufio.Reader
	spawned bool
}

// WorkerError is a protocol-level error reported by the script itself.
type WorkerError struct {
	Script  string
	Message string
}

func (e *WorkerError) Error() string {
	if e.Script == "" {
		return e.Message
	}
	return fmt.Sprintf("%s worker: %s", e.Script, e.Message)
}

// New creates a lazily spawned worker for script.
func New(script Script, opts ...Option) *Worker {
	cfg := config{
		maxResponseBytes: defaultMaxResponseBytes,
		nodeResolver:     FindNodePath,
	}
	for _, opt := range opts {
		opt(&cfg)
	}
	if cfg.nodeResolver == nil {
		cfg.nodeResolver = FindNodePath
	}
	return &Worker{script: script, config: cfg}
}

// Call marshals req as a JSON line, reads one response line, and unmarshals it
// into Resp. Go methods cannot be generic, so this is package-level.
func Call[Resp any](ctx context.Context, w *Worker, req any) (Resp, error) {
	var zero Resp
	raw, err := CallRaw(ctx, w, req)
	if err != nil {
		return zero, err
	}
	var resp Resp
	if err := json.Unmarshal(raw, &resp); err != nil {
		return zero, fmt.Errorf("unmarshal response: %w", err)
	}
	return resp, nil
}

// CallRaw performs a single JSON-line request/response round trip.
func CallRaw(ctx context.Context, w *Worker, req any) (json.RawMessage, error) {
	if w == nil {
		return nil, fmt.Errorf("nodeworker: nil worker")
	}
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
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	data = append(data, '\n')
	if _, err := w.stdin.Write(data); err != nil {
		w.killLocked()
		return nil, fmt.Errorf("write to worker: %w", err)
	}

	stdout := w.stdout
	resultCh := make(chan scanResult, 1)
	go func() {
		resultCh <- scanLine(stdout, w.config.maxResponseBytes)
	}()

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
		if workerErr := decodeWorkerError(w.script.Name, result.bytes); workerErr != nil {
			return nil, workerErr
		}
		return json.RawMessage(result.bytes), nil
	}
}

// Close shuts down the worker process.
func (w *Worker) Close() error {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.spawned || w.cmd == nil || w.cmd.Process == nil {
		return nil
	}
	slog.Info("stopping node worker", "script", w.script.Name)
	if w.stdin != nil {
		_ = w.stdin.Close()
	}
	err := w.cmd.Wait()
	w.resetLocked()
	return err
}

func (w *Worker) ensureSpawned() error {
	if w.spawned {
		return nil
	}

	var cmd *exec.Cmd
	var nodePath string
	if w.config.commandPath != "" {
		cmd = exec.Command(w.config.commandPath, w.config.commandArgs...)
	} else {
		scriptPath := w.config.scriptPath
		if scriptPath == "" {
			if w.script.Name == "" {
				return fmt.Errorf("nodeworker: script name is required")
			}
			var err error
			scriptPath, err = ExtractEmbedded(w.script.Name, w.script.Content)
			if err != nil {
				return fmt.Errorf("extract %s worker: %w", w.script.Name, err)
			}
		}
		resolved, err := w.config.nodeResolver()
		if err != nil {
			return fmt.Errorf("node not found: %w", err)
		}
		nodePath = resolved
		cmd = exec.Command(nodePath, scriptPath)
	}
	cmd.Stderr = os.Stderr
	configureProcessGroup(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return fmt.Errorf("stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return fmt.Errorf("start worker: %w", err)
	}

	w.cmd = cmd
	w.stdin = stdin
	w.stdout = bufio.NewReaderSize(stdout, stdoutBufferBytes)
	w.spawned = true
	attrs := []any{"script", w.script.Name, "pid", cmd.Process.Pid}
	if nodePath != "" {
		attrs = append(attrs, "node", nodePath, "nodeVersion", NodeVersion(nodePath))
	}
	slog.Info("node worker started", attrs...)
	return nil
}

func (w *Worker) killLocked() {
	if !w.spawned || w.cmd == nil || w.cmd.Process == nil {
		w.resetLocked()
		return
	}
	slog.Warn("stopping node worker after request failure", "script", w.script.Name)
	killProcessGroup(w.cmd)
	if w.stdin != nil {
		_ = w.stdin.Close()
	}
	_ = w.cmd.Wait()
	w.resetLocked()
}

func (w *Worker) resetLocked() {
	w.spawned = false
	w.cmd = nil
	w.stdin = nil
	w.stdout = nil
}

type scanResult struct {
	bytes []byte
	err   error
}

func scanLine(stdout *bufio.Reader, maxBytes int) scanResult {
	if stdout == nil {
		return scanResult{err: fmt.Errorf("nodeworker: stdout unavailable")}
	}
	var line []byte
	for {
		chunk, err := stdout.ReadSlice('\n')
		line = append(line, chunk...)
		if maxBytes > 0 && len(line) > maxBytes {
			return scanResult{err: fmt.Errorf("nodeworker: response exceeded %d bytes", maxBytes)}
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) && len(line) == 0 {
			return scanResult{err: fmt.Errorf("nodeworker: no output (EOF)")}
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return scanResult{err: fmt.Errorf("nodeworker: read response: %w", err)}
		}
		break
	}
	line = bytes.TrimSuffix(line, []byte("\n"))
	line = bytes.TrimSuffix(line, []byte("\r"))
	return scanResult{bytes: line}
}

func decodeWorkerError(script string, raw []byte) error {
	var envelope struct {
		Error string `json:"error,omitempty"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil
	}
	if envelope.Error == "" {
		return nil
	}
	return &WorkerError{Script: script, Message: envelope.Error}
}

func cacheDir() (string, error) {
	if dir := os.Getenv("CRUX_CACHE_DIR"); dir != "" {
		return dir, nil
	}
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "crux"), nil
}

// ExtractEmbedded writes an embedded script to the content-addressed cache.
func ExtractEmbedded(name string, content []byte) (string, error) {
	dir, err := cacheDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine cache directory: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("cannot create cache directory %s: %w", dir, err)
	}

	hash := fmt.Sprintf("%x", sha256.Sum256(content))[:12]
	path := filepath.Join(dir, fmt.Sprintf("%s-%s.mjs", name, hash))
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return "", fmt.Errorf("cannot write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("cannot rename %s to %s: %w", tmp, path, err)
	}
	return path, nil
}

// FindNodePath locates a Node.js binary that can run embedded workers.
func FindNodePath() (string, error) {
	candidates := CandidateNodePaths()
	for _, candidate := range candidates {
		if NodeMajorVersion(candidate) >= 24 {
			return candidate, nil
		}
	}
	if len(candidates) > 0 {
		return "", fmt.Errorf("Node.js >= 24 not found; first candidate %s is %s", candidates[0], NodeVersion(candidates[0]))
	}
	return "", fmt.Errorf("Node.js >= 24 not found in PATH or nvm installs")
}

func CandidateNodePaths() []string {
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

func NodeMajorVersion(path string) int {
	version := NodeVersion(path)
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	major, _, _ := strings.Cut(version, ".")
	value, err := strconv.Atoi(major)
	if err != nil {
		return 0
	}
	return value
}

func NodeVersion(path string) string {
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
