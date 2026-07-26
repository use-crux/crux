package compiler

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// Static is the Go-owned boundary for the Rust/Oxc static compiler lane.
// It is separate from syntax-record parsing so callers can prove the compiler
// lane does not call Node projection or syntax-record bridges.
type Static interface {
	StaticIndexPrepare(context.Context, protocol.PrepareRequest) (protocol.PrepareResponse, error)
	StaticIndexAnalyzeStream(context.Context, protocol.AnalyzeRequest, protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error)
	StaticIndexFinalize(context.Context, protocol.FinalizeRequest) (protocol.FinalizeResponse, error)
	StaticIndexFinalizeStream(context.Context, protocol.FinalizeRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
}

type CompileStreamer interface {
	StaticIndexCompileStream(context.Context, protocol.CompileRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
}

// Completer runs transient, cache-bypassing compiler queries on the persistent
// worker process.
type Completer interface {
	Completion(context.Context, protocol.CompletionQuery) (protocol.CompletionResponse, error)
}

// PromptTextAnalyzer runs normalized, cache-bypassing PromptText queries on
// the persistent worker process.
type PromptTextAnalyzer interface {
	PromptText(context.Context, protocol.PromptTextQuery) (protocol.PromptTextQueryResponse, error)
}

type Worker struct {
	*frontend.Worker
}

func New(commandPath string, commandArgs ...string) *Worker {
	return &Worker{Worker: frontend.New(commandPath, commandArgs...)}
}

type Pool struct {
	*frontend.Pool
}

func NewPool(size int, commandPath string, commandArgs ...string) *Pool {
	return &Pool{Pool: frontend.NewPool(size, commandPath, commandArgs...)}
}

func NewPoolWithProcessOptions(size int, commandPath string, processOptions []workerproc.Option, commandArgs ...string) *Pool {
	return &Pool{Pool: frontend.NewPoolWithProcessOptions(size, commandPath, processOptions, commandArgs...)}
}

func NewAdaptivePool(maxSize int, commandPath string, commandArgs ...string) *Pool {
	return &Pool{Pool: frontend.NewAdaptivePool(maxSize, commandPath, commandArgs...)}
}

func NewAdaptivePoolWithProcessOptions(maxSize int, commandPath string, processOptions []workerproc.Option, commandArgs ...string) *Pool {
	return &Pool{Pool: frontend.NewAdaptivePoolWithProcessOptions(maxSize, commandPath, processOptions, commandArgs...)}
}

func (p *Pool) staticIndexWorker() (*Worker, error) {
	worker, err := p.CompilerWorker()
	if err != nil {
		return nil, err
	}
	return &Worker{Worker: worker}, nil
}

func (w *Worker) StaticIndexPrepare(ctx context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	id := w.NextID()
	request.ID = id
	envelope, err := call[protocol.WorkerResponse[protocol.PrepareResponse]](ctx, w, request)
	if err != nil {
		return protocol.PrepareResponse{}, err
	}
	if err := protocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return protocol.PrepareResponse{}, err
	}
	response := envelope.Response
	return response, protocol.ValidateResponse(response.ProtocolVersion, response.Method, protocol.PrepareMethod)
}

func (w *Worker) StaticIndexFinalize(ctx context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	if err := protocol.ValidateLintSuppressions(request.LintSuppressions); err != nil {
		return protocol.FinalizeResponse{}, err
	}
	id := w.NextID()
	request.ID = id
	envelope, err := call[protocol.WorkerResponse[protocol.FinalizeResponse]](ctx, w, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	if err := protocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return protocol.FinalizeResponse{}, err
	}
	response := envelope.Response
	return response, protocol.ValidateResponse(response.ProtocolVersion, response.Method, protocol.FinalizeMethod)
}

func (p *Pool) StaticIndexPrepare(ctx context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	worker, err := p.staticIndexWorker()
	if err != nil {
		return protocol.PrepareResponse{}, err
	}
	return worker.StaticIndexPrepare(ctx, request)
}

func (p *Pool) StaticIndexFinalize(ctx context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	worker, err := p.staticIndexWorker()
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return worker.StaticIndexFinalize(ctx, request)
}

// Completion runs one transient query without entering the Static Index stage
// pipeline or changing its cache identity.
func (w *Worker) Completion(ctx context.Context, query protocol.CompletionQuery) (protocol.CompletionResponse, error) {
	id := w.NextID()
	request := protocol.CompletionWorkerRequest{
		ID:     id,
		Method: protocol.CompletionMethod,
		Query:  query,
	}
	envelope, err := call[protocol.WorkerResponse[protocol.CompletionResponse]](ctx, w, request)
	if err != nil {
		return protocol.CompletionResponse{}, err
	}
	if err := protocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return protocol.CompletionResponse{}, err
	}
	return envelope.Response, nil
}

// Completion borrows one already-running worker from the compiler pool.
func (p *Pool) Completion(ctx context.Context, query protocol.CompletionQuery) (protocol.CompletionResponse, error) {
	worker, err := p.staticIndexWorker()
	if err != nil {
		return protocol.CompletionResponse{}, err
	}
	return worker.Completion(ctx, query)
}

// PromptText runs one transient query without entering Static Index stages.
func (w *Worker) PromptText(
	ctx context.Context,
	query protocol.PromptTextQuery,
) (protocol.PromptTextQueryResponse, error) {
	id := w.NextID()
	request := protocol.PromptTextWorkerRequest{
		ID: id, Method: protocol.PromptTextMethod, Query: query,
	}
	envelope, err := call[protocol.WorkerResponse[protocol.PromptTextQueryResponse]](ctx, w, request)
	if err != nil {
		return protocol.PromptTextQueryResponse{}, err
	}
	if err := protocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return protocol.PromptTextQueryResponse{}, err
	}
	return envelope.Response, nil
}

// PromptText borrows one already-running worker from the compiler pool.
func (p *Pool) PromptText(
	ctx context.Context,
	query protocol.PromptTextQuery,
) (protocol.PromptTextQueryResponse, error) {
	worker, err := p.staticIndexWorker()
	if err != nil {
		return protocol.PromptTextQueryResponse{}, err
	}
	return worker.PromptText(ctx, query)
}

func call[Resp any](ctx context.Context, worker *Worker, request any) (Resp, error) {
	var zero Resp
	if worker == nil || worker.Process() == nil {
		return zero, fmt.Errorf("project Static Index compiler is not configured")
	}
	return workerproc.Call[Resp](ctx, worker.Process(), request)
}
