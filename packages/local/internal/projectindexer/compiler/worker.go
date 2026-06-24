package compiler

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"
)

// Static is the Go-owned boundary for the Rust/Oxc static compiler lane.
// It is separate from syntax-record parsing so callers can prove the compiler
// lane does not call Node projection or syntax-record bridges.
type Static interface {
	NativeStaticPrepare(context.Context, staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error)
	NativeStaticAnalyzeStream(context.Context, staticprotocol.AnalyzeRequest, staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error)
	NativeStaticFinalize(context.Context, staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error)
	NativeStaticFinalizeStream(context.Context, staticprotocol.FinalizeRequest, staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error)
}

type CompileStreamer interface {
	NativeStaticCompileStream(context.Context, staticprotocol.CompileRequest, staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error)
}

type Worker struct {
	*syntax.Worker
}

func New(commandPath string, commandArgs ...string) *Worker {
	return &Worker{Worker: syntax.New(commandPath, commandArgs...)}
}

type Pool struct {
	*syntax.Pool
}

func NewPool(size int, commandPath string, commandArgs ...string) *Pool {
	return &Pool{Pool: syntax.NewPool(size, commandPath, commandArgs...)}
}

func NewAdaptivePool(maxSize int, commandPath string, commandArgs ...string) *Pool {
	return &Pool{Pool: syntax.NewAdaptivePool(maxSize, commandPath, commandArgs...)}
}

func (p *Pool) compilerWorker() (*Worker, error) {
	worker, err := p.CompilerWorker()
	if err != nil {
		return nil, err
	}
	return &Worker{Worker: worker}, nil
}

func (w *Worker) NativeStaticPrepare(ctx context.Context, request staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	id := w.NextID()
	request.ID = id
	envelope, err := call[staticprotocol.WorkerResponse[staticprotocol.PrepareResponse]](ctx, w, request)
	if err != nil {
		return staticprotocol.PrepareResponse{}, err
	}
	if err := staticprotocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return staticprotocol.PrepareResponse{}, err
	}
	response := envelope.Response
	return response, staticprotocol.ValidateResponse(response.ProtocolVersion, response.Method, staticprotocol.PrepareMethod)
}

func (w *Worker) NativeStaticFinalize(ctx context.Context, request staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error) {
	id := w.NextID()
	request.ID = id
	envelope, err := call[staticprotocol.WorkerResponse[staticprotocol.FinalizeResponse]](ctx, w, request)
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	if err := staticprotocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	response := envelope.Response
	return response, staticprotocol.ValidateResponse(response.ProtocolVersion, response.Method, staticprotocol.FinalizeMethod)
}

func (p *Pool) NativeStaticPrepare(ctx context.Context, request staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return staticprotocol.PrepareResponse{}, err
	}
	return worker.NativeStaticPrepare(ctx, request)
}

func (p *Pool) NativeStaticFinalize(ctx context.Context, request staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return worker.NativeStaticFinalize(ctx, request)
}

func call[Resp any](ctx context.Context, worker *Worker, request any) (Resp, error) {
	var zero Resp
	if worker == nil || worker.Process() == nil {
		return zero, fmt.Errorf("project native static compiler is not configured")
	}
	return nodeworker.Call[Resp](ctx, worker.Process(), request)
}
