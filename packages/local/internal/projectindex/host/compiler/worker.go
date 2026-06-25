package compiler

import (
	"context"
	"fmt"

	nodeprocess "github.com/use-crux/crux/packages/local/internal/process/node"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

// Static is the Go-owned boundary for the Rust/Oxc static compiler lane.
// It is separate from syntax-record parsing so callers can prove the compiler
// lane does not call Node projection or syntax-record bridges.
type Static interface {
	NativeStaticPrepare(context.Context, protocol.PrepareRequest) (protocol.PrepareResponse, error)
	NativeStaticAnalyzeStream(context.Context, protocol.AnalyzeRequest, protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error)
	NativeStaticFinalize(context.Context, protocol.FinalizeRequest) (protocol.FinalizeResponse, error)
	NativeStaticFinalizeStream(context.Context, protocol.FinalizeRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
}

type CompileStreamer interface {
	NativeStaticCompileStream(context.Context, protocol.CompileRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
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

func (w *Worker) NativeStaticPrepare(ctx context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
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

func (w *Worker) NativeStaticFinalize(ctx context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
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

func (p *Pool) NativeStaticPrepare(ctx context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return protocol.PrepareResponse{}, err
	}
	return worker.NativeStaticPrepare(ctx, request)
}

func (p *Pool) NativeStaticFinalize(ctx context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return worker.NativeStaticFinalize(ctx, request)
}

func call[Resp any](ctx context.Context, worker *Worker, request any) (Resp, error) {
	var zero Resp
	if worker == nil || worker.Process() == nil {
		return zero, fmt.Errorf("project native static compiler is not configured")
	}
	return nodeprocess.Call[Resp](ctx, worker.Process(), request)
}
