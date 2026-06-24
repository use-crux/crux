package projectindexer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
)

// SyntaxWorkerPool fans syntax parse requests out across multiple
// command-backed workers. Each worker keeps the same JSON-lines protocol as the
// single-worker path; the pool only controls process-level parallelism.
type SyntaxWorkerPool struct {
	workers  []*SyntaxWorker
	adaptive bool
	next     atomic.Uint64
}

type syntaxWorkerPoolBatchJob struct {
	workerIndex int
	indexes     []int
	requests    []SyntaxParseRequest
}

// NewSyntaxWorkerPool creates a fixed-size pool of command-backed
// Rust/Oxc indexer workers. Non-positive sizes are normalized to one worker.
func NewSyntaxWorkerPool(size int, commandPath string, commandArgs ...string) *SyntaxWorkerPool {
	return newSyntaxWorkerPool(size, false, commandPath, commandArgs...)
}

// NewAdaptiveSyntaxWorkerPool creates a bounded pool that chooses the
// active worker count per batch size. It keeps unused workers lazy, so small
// projects do not pay process startup or RSS for the maximum pool size.
func NewAdaptiveSyntaxWorkerPool(maxSize int, commandPath string, commandArgs ...string) *SyntaxWorkerPool {
	return newSyntaxWorkerPool(maxSize, true, commandPath, commandArgs...)
}

func newSyntaxWorkerPool(size int, adaptive bool, commandPath string, commandArgs ...string) *SyntaxWorkerPool {
	if size < 1 {
		size = 1
	}
	workers := make([]*SyntaxWorker, 0, size)
	for i := 0; i < size; i++ {
		workers = append(workers, NewSyntaxWorker(commandPath, commandArgs...))
	}
	return &SyntaxWorkerPool{workers: workers, adaptive: adaptive}
}

// ParseFile sends a single parse request to one worker in the pool.
func (p *SyntaxWorkerPool) ParseFile(ctx context.Context, request SyntaxParseRequest) (json.RawMessage, error) {
	if p == nil || len(p.workers) == 0 {
		return nil, fmt.Errorf("project indexer worker pool is not configured")
	}
	index := int((p.next.Add(1) - 1) % uint64(len(p.workers)))
	return p.workers[index].ParseFile(ctx, request)
}

// ParseFiles shards a batch parse request across workers in the pool and
// returns raw syntax records in the same order as the input requests.
func (p *SyntaxWorkerPool) ParseFiles(ctx context.Context, requests []SyntaxParseRequest) ([]json.RawMessage, error) {
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
func (p *SyntaxWorkerPool) ParseFilesStream(ctx context.Context, requests []SyntaxParseRequest, handle SyntaxRecordHandler) error {
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

// NativeStaticPrepare runs the native static compiler prepare stage on one
// command worker. Native static compilation is a run-level protocol, not a
// per-file parse workload, so the pool must not shard it across processes.
func (p *SyntaxWorkerPool) NativeStaticPrepare(ctx context.Context, request projectNativeStaticPrepareRequest) (projectNativeStaticPrepareResponse, error) {
	worker, err := p.nativeStaticCompilerWorker()
	if err != nil {
		return projectNativeStaticPrepareResponse{}, err
	}
	return worker.NativeStaticPrepare(ctx, request)
}

// NativeStaticFinalize runs native static relation/fact finalization on one
// command worker so event ordering stays owned by the compiler process.
func (p *SyntaxWorkerPool) NativeStaticFinalize(ctx context.Context, request projectNativeStaticFinalizeRequest) (projectNativeStaticFinalizeResponse, error) {
	worker, err := p.nativeStaticCompilerWorker()
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	return worker.NativeStaticFinalize(ctx, request)
}

func (p *SyntaxWorkerPool) nativeStaticCompilerWorker() (*SyntaxWorker, error) {
	if p == nil || len(p.workers) == 0 {
		return nil, fmt.Errorf("project indexer worker pool is not configured")
	}
	return p.workers[0], nil
}

func (p *SyntaxWorkerPool) activeWorkerCount(requestCount int) int {
	if p == nil || len(p.workers) == 0 || requestCount <= 0 {
		return 0
	}
	workerCount := len(p.workers)
	if p.adaptive {
		workerCount = adaptiveSyntaxWorkerCount(requestCount, workerCount)
	}
	if workerCount > requestCount {
		workerCount = requestCount
	}
	if workerCount < 1 {
		return 1
	}
	return workerCount
}

func adaptiveSyntaxWorkerCount(requestCount int, maxWorkers int) int {
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

// Concurrency reports the pool size.
func (p *SyntaxWorkerPool) Concurrency() int {
	if p == nil {
		return 0
	}
	return len(p.workers)
}

// Close shuts down every worker process in the pool.
func (p *SyntaxWorkerPool) Close() error {
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

func syntaxWorkerPoolBatchJobs(requests []SyntaxParseRequest, workerCount int) []syntaxWorkerPoolBatchJob {
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
