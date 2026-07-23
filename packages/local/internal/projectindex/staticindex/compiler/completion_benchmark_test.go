package compiler

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

const (
	completionBenchmarkDeadline = 250 * time.Millisecond
	completionBenchmarkP99Goal  = 150 * time.Millisecond
)

// BenchmarkCompletionPersistentWorkerWarmLatency records the representative
// warm distribution and fails if the query exceeds its product deadline or
// p99 goal. Run with a built worker and a fixed sample count:
//
//	CRUX_STATIC_INDEX_WORKER=/path/to/crux-static-index-worker \
//	  go test ./internal/projectindex/staticindex/compiler \
//	  -run '^$' -bench BenchmarkCompletionPersistentWorkerWarmLatency \
//	  -benchtime=100x
func BenchmarkCompletionPersistentWorkerWarmLatency(b *testing.B) {
	workerPath := os.Getenv("CRUX_STATIC_INDEX_WORKER")
	if workerPath == "" {
		b.Skip("set CRUX_STATIC_INDEX_WORKER to a built native worker")
	}
	var lifecycle bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&lifecycle, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	pool := NewPoolWithProcessOptions(
		1,
		workerPath,
		[]workerproc.Option{
			workerproc.WithLogger(logger),
			workerproc.WithStderr(io.Discard),
		},
		"serve",
	)
	defer pool.Close()
	query := representativeCompletionBenchmarkQuery()
	warm, err := pool.Completion(context.Background(), query)
	if err != nil {
		b.Fatalf("warm completion: %v", err)
	}
	if len(warm.Items) != 1 || warm.Items[0].ID != "prompt:writer" {
		b.Fatalf("warm completion = %#v, want representative writer item", warm)
	}

	durations := make([]time.Duration, 0, b.N)
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		started := time.Now()
		ctx, cancel := context.WithTimeout(
			context.Background(),
			completionBenchmarkDeadline,
		)
		_, err := pool.Completion(ctx, query)
		cancel()
		duration := time.Since(started)
		if err != nil {
			b.Fatalf("warm completion %d: %v", index+1, err)
		}
		if duration > completionBenchmarkDeadline {
			b.Fatalf(
				"warm completion %d = %s, deadline %s",
				index+1,
				duration,
				completionBenchmarkDeadline,
			)
		}
		durations = append(durations, duration)
	}
	b.StopTimer()

	p50 := completionPercentile(durations, 0.50)
	p95 := completionPercentile(durations, 0.95)
	p99 := completionPercentile(durations, 0.99)
	b.ReportMetric(float64(p50.Microseconds())/1000, "warm_p50_ms")
	b.ReportMetric(float64(p95.Microseconds())/1000, "warm_p95_ms")
	b.ReportMetric(float64(p99.Microseconds())/1000, "warm_p99_ms")
	if p99 > completionBenchmarkP99Goal {
		b.Fatalf("warm completion p99 = %s, goal %s", p99, completionBenchmarkP99Goal)
	}
	if starts := strings.Count(lifecycle.String(), "worker process started"); starts != 1 {
		b.Fatalf("worker starts = %d, want one persistent process", starts)
	}
}

func representativeCompletionBenchmarkQuery() protocol.CompletionQuery {
	lines := []string{
		"import { prompt, tool } from '@use-crux/core'",
		"import { agent } from '@use-crux/core/agent'",
		"export const writer = prompt({ id: 'writer' })",
		"export const lookup = tool({ name: 'lookup' })",
		"export const support = agent({ id: 'support', prompt: wr",
	}
	return protocol.CompletionQuery{
		File:       "/repo/src/agent.ts",
		LanguageID: "typescript",
		Source:     strings.Join(lines, "\n"),
		Position: protocol.CompletionPosition{
			Line: 4, Character: uint32(len(lines[4])),
		},
		Candidates: []protocol.CompletionCandidate{{
			ID: "prompt:writer", Kind: "prompt", Name: "writer",
			Binding: "writer", File: "/repo/src/agent.ts", Line: 2,
		}},
		Limit: 100,
	}
}

func completionPercentile(
	values []time.Duration,
	percentile float64,
) time.Duration {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]time.Duration(nil), values...)
	slices.Sort(sorted)
	index := int(float64(len(sorted)-1) * percentile)
	return sorted[index]
}
