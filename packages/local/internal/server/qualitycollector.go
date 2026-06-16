package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sync"
	"time"
)

// QualityEvaluationCollector serves the spec-02 Evaluation manifests for the
// `/api/quality/evaluations` read model by running the embedded quality
// worker in `--collect-only` mode against the project (the same collect that
// backs `crux quality list`). Collect imports the project's eval files but
// never executes a task body, expect callback, or scorer.
//
// Results are cached: collect loads the full project config (~2s on a large
// backend), so the endpoint refreshes at most once per TTL and serves the
// last good snapshot when a refresh fails.
type QualityEvaluationCollector struct {
	projectRoot string
	configPath  string
	ttl         time.Duration

	// collect is injectable for tests; defaults to the embedded-worker spawn.
	collect func(context.Context) ([]json.RawMessage, error)

	mu        sync.Mutex
	cached    []json.RawMessage
	hasCache  bool
	fetchedAt time.Time
}

const qualityCollectTTL = 15 * time.Second
const qualityCollectTimeout = 120 * time.Second

// NewQualityEvaluationCollector creates a collector rooted at the project.
func NewQualityEvaluationCollector(projectRoot, configPath string) *QualityEvaluationCollector {
	collector := &QualityEvaluationCollector{
		projectRoot: projectRoot,
		configPath:  configPath,
		ttl:         qualityCollectTTL,
	}
	collector.collect = collector.collectFromWorker
	return collector
}

// EvaluationManifests returns the discovered manifests as verbatim raw JSON
// (spec-02 §2 — the schema evolves additively; nothing re-marshals them).
func (c *QualityEvaluationCollector) EvaluationManifests(ctx context.Context) ([]json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.hasCache && time.Since(c.fetchedAt) < c.ttl {
		return c.cached, nil
	}
	manifests, err := c.collect(ctx)
	if err != nil {
		if c.hasCache {
			return c.cached, nil
		}
		return nil, err
	}
	c.cached = manifests
	c.hasCache = true
	c.fetchedAt = time.Now()
	return manifests, nil
}

func (c *QualityEvaluationCollector) collectFromWorker(ctx context.Context) ([]json.RawMessage, error) {
	nodePath, err := FindNode()
	if err != nil {
		return nil, err
	}
	runnerPath, err := ExtractQualityRunner()
	if err != nil {
		return nil, fmt.Errorf("failed to extract embedded quality runner: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, qualityCollectTimeout)
	defer cancel()

	args := []string{"--import", "tsx/esm", runnerPath, "--collect-only"}
	if c.configPath != "" {
		args = append(args, "--config", c.configPath)
	}
	cmd := exec.CommandContext(ctx, nodePath, args...)
	if c.projectRoot != "" {
		cmd.Dir = c.projectRoot
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// collect errors exit non-zero but still emit collect:done — prefer
		// the structured stream over the exit code.
		if manifests, collectErrors, parseErr := extractCollectManifests(stdout.Bytes()); parseErr == nil {
			return manifestsOrError(manifests, collectErrors)
		}
		return nil, fmt.Errorf("quality collect failed: %w: %s", err, tail(stderr.String(), 400))
	}
	manifests, collectErrors, err := extractCollectManifests(stdout.Bytes())
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, tail(stderr.String(), 400))
	}
	return manifestsOrError(manifests, collectErrors)
}

func manifestsOrError(manifests []json.RawMessage, collectErrors []json.RawMessage) ([]json.RawMessage, error) {
	if len(manifests) == 0 && len(collectErrors) > 0 {
		return nil, fmt.Errorf("quality collect reported errors: %s", collectErrors[0])
	}
	return manifests, nil
}

// extractCollectManifests scans the worker's NDJSON stream (spec 03 §2) for
// the collect:done event and returns its manifests verbatim.
func extractCollectManifests(stdout []byte) ([]json.RawMessage, []json.RawMessage, error) {
	scanner := bufio.NewScanner(bytes.NewReader(stdout))
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		var event struct {
			Type        string            `json:"type"`
			Evaluations []json.RawMessage `json:"evaluations"`
			Errors      []json.RawMessage `json:"errors"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		if event.Type == "collect:done" {
			manifests := event.Evaluations
			if manifests == nil {
				manifests = []json.RawMessage{}
			}
			return manifests, event.Errors, nil
		}
	}
	return nil, nil, fmt.Errorf("quality collect produced no collect:done event")
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "…" + s[len(s)-n:]
}
