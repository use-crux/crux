package workerproc

import (
	"bufio"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
)

const (
	defaultMaxResponseBytes = 16 * 1024 * 1024
	stdoutBufferBytes       = 64 * 1024
)

// Script identifies a worker script that can be extracted and run with Node.js.
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

// Worker is a lazy, persistent JSON-line subprocess.
type Worker struct {
	mu      sync.Mutex
	script  Script
	config  config
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  *bufio.Reader
	spawned bool
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
	slog.Info("stopping worker process", "script", w.script.Name)
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
				return fmt.Errorf("worker process: script name is required")
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
	slog.Info("worker process started", attrs...)
	return nil
}

func (w *Worker) killLocked() {
	if !w.spawned || w.cmd == nil || w.cmd.Process == nil {
		w.resetLocked()
		return
	}
	slog.Warn("stopping worker process after request failure", "script", w.script.Name)
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
