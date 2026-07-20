package frontend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

// Pool fans syntax parse requests out across multiple
// command-backed workers. Each worker keeps the same JSON-lines protocol as the
// single-worker path; the pool only controls process-level parallelism.
type Pool struct {
	workers  []*Worker
	adaptive bool
	next     atomic.Uint64
}

type syntaxWorkerPoolBatchJob struct {
	workerIndex int
	indexes     []int
	requests    []Request
}

// NewPool creates a fixed-size pool of command-backed
// Rust/Oxc indexer workers. Non-positive sizes are normalized to one worker.
func NewPool(size int, commandPath string, commandArgs ...string) *Pool {
	return newPool(size, false, commandPath, nil, commandArgs...)
}

// NewPoolWithProcessOptions creates a fixed pool with explicit subprocess
// diagnostic boundaries applied to every lazy worker.
func NewPoolWithProcessOptions(size int, commandPath string, processOptions []workerproc.Option, commandArgs ...string) *Pool {
	return newPool(size, false, commandPath, processOptions, commandArgs...)
}

// NewAdaptivePool creates a bounded pool that chooses the
// active worker count per batch size. It keeps unused workers lazy, so small
// projects do not pay process startup or RSS for the maximum pool size.
func NewAdaptivePool(maxSize int, commandPath string, commandArgs ...string) *Pool {
	return newPool(maxSize, true, commandPath, nil, commandArgs...)
}

// NewAdaptivePoolWithProcessOptions creates an adaptive pool with explicit
// subprocess diagnostic boundaries applied to every lazy worker.
func NewAdaptivePoolWithProcessOptions(maxSize int, commandPath string, processOptions []workerproc.Option, commandArgs ...string) *Pool {
	return newPool(maxSize, true, commandPath, processOptions, commandArgs...)
}

func newPool(size int, adaptive bool, commandPath string, processOptions []workerproc.Option, commandArgs ...string) *Pool {
	if size < 1 {
		size = 1
	}
	workers := make([]*Worker, 0, size)
	for i := 0; i < size; i++ {
		workers = append(workers, NewWithProcessOptions(commandPath, processOptions, commandArgs...))
	}
	return &Pool{workers: workers, adaptive: adaptive}
}

// ParseFile sends a single parse request to one worker in the pool.
func (p *Pool) ParseFile(ctx context.Context, request Request) (json.RawMessage, error) {
	if p == nil || len(p.workers) == 0 {
		return nil, fmt.Errorf("project indexer worker pool is not configured")
	}
	index := int((p.next.Add(1) - 1) % uint64(len(p.workers)))
	return p.workers[index].ParseFile(ctx, request)
}

// ParseFiles shards a batch parse request across workers in the pool and
// returns raw syntax records in the same order as the input requests.
func (p *Pool) ParseFiles(ctx context.Context, requests []Request) ([]json.RawMessage, error) {
	if p == nil || len(p.workers) == 0 {
		return nil, fmt.Errorf("project indexer worker pool is not configured")
	}
	if len(requests) == 0 {
		return []json.RawMessage{}, nil
	}
	records := make([]json.RawMessage, len(requests))
	if err := p.ParseFilesStream(ctx, requests, func(index int, record json.RawMessage) error {
		records[index] = record
		return nil
	}); err != nil {
		return nil, err
	}
	return records, nil
}

// ParseFilesStream shards a batch parse request across workers in the pool and
// streams records with caller-global indexes.
func (p *Pool) ParseFilesStream(ctx context.Context, requests []Request, handle RecordHandler) error {
	if p == nil || len(p.workers) == 0 {
		return fmt.Errorf("project indexer worker pool is not configured")
	}
	if handle == nil {
		return fmt.Errorf("project indexer worker stream handler is not configured")
	}
	if len(requests) == 0 {
		return nil
	}
	workerCount := p.activeWorkerCount(len(requests))
	if workerCount == 1 || len(requests) == 1 {
		return p.workers[0].ParseFilesStream(ctx, requests, handle)
	}

	jobs := syntaxWorkerPoolBatchJobs(requests, workerCount)
	parseCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	errs := make(chan error, len(jobs))
	var wg sync.WaitGroup
	var handleMu sync.Mutex

	for _, job := range jobs {
		job := job
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := p.workers[job.workerIndex].ParseFilesStream(parseCtx, job.requests, func(localIndex int, record json.RawMessage) error {
				if localIndex < 0 || localIndex >= len(job.indexes) {
					return fmt.Errorf("project indexer worker shard returned record index %d, want 0-%d", localIndex, len(job.indexes)-1)
				}
				globalIndex := job.indexes[localIndex]
				handleMu.Lock()
				defer handleMu.Unlock()
				if err := parseCtx.Err(); err != nil {
					return err
				}
				return handle(globalIndex, record)
			})
			if err != nil {
				errs <- err
				cancel()
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return nil
}

// CompilerWorker returns the single command worker that must own protocols
// with run-level ordering requirements.
func (p *Pool) CompilerWorker() (*Worker, error) {
	if p == nil || len(p.workers) == 0 {
		return nil, fmt.Errorf("project indexer worker pool is not configured")
	}
	return p.workers[0], nil
}

func (p *Pool) activeWorkerCount(requestCount int) int {
	if p == nil || len(p.workers) == 0 || requestCount <= 0 {
		return 0
	}
	workerCount := len(p.workers)
	if p.adaptive {
		workerCount = adaptiveWorkerCount(requestCount, workerCount)
	}
	if workerCount > requestCount {
		workerCount = requestCount
	}
	if workerCount < 1 {
		return 1
	}
	return workerCount
}

func (p *Pool) ActiveWorkerCount(requestCount int) int {
	return p.activeWorkerCount(requestCount)
}

func adaptiveWorkerCount(requestCount int, maxWorkers int) int {
	if maxWorkers <= 1 || requestCount <= 512 {
		return 1
	}
	if requestCount <= 2_000 {
		if maxWorkers < 2 {
			return maxWorkers
		}
		return 2
	}
	return maxWorkers
}

func AdaptiveWorkerCount(requestCount int, maxWorkers int) int {
	return adaptiveWorkerCount(requestCount, maxWorkers)
}

// Concurrency reports the pool size.
func (p *Pool) Concurrency() int {
	if p == nil {
		return 0
	}
	return len(p.workers)
}

// Close shuts down every worker process in the pool.
func (p *Pool) Close() error {
	if p == nil {
		return nil
	}
	errs := make([]error, 0, len(p.workers))
	for _, worker := range p.workers {
		if err := worker.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func syntaxWorkerPoolBatchJobs(requests []Request, workerCount int) []syntaxWorkerPoolBatchJob {
	if workerCount > len(requests) {
		workerCount = len(requests)
	}
	jobs := make([]syntaxWorkerPoolBatchJob, workerCount)
	for index := range jobs {
		jobs[index].workerIndex = index
	}
	for index, request := range requests {
		jobIndex := index % workerCount
		jobs[jobIndex].indexes = append(jobs[jobIndex].indexes, index)
		jobs[jobIndex].requests = append(jobs[jobIndex].requests, request)
	}
	return jobs
}
