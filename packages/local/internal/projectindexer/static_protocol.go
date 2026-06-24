package projectindexer

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

// StaticCompiler is the Go-owned boundary for the Rust/Oxc static
// compiler lane. It is intentionally separate from syntax-record parsing so
// tests can prove the compiler lane does not call Node projection or
// syntax-record bridges.
type StaticCompiler interface {
	NativeStaticPrepare(context.Context, staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error)
	NativeStaticAnalyzeStream(context.Context, staticprotocol.AnalyzeRequest, staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error)
	NativeStaticFinalize(context.Context, staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error)
	NativeStaticFinalizeStream(context.Context, staticprotocol.FinalizeRequest, staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error)
}

func (w *syntaxCompilerWorker) NativeStaticPrepare(ctx context.Context, request staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	id := w.NextID()
	request.ID = id
	envelope, err := projectNativeStaticCall[staticprotocol.WorkerResponse[staticprotocol.PrepareResponse]](ctx, w, request)
	if err != nil {
		return staticprotocol.PrepareResponse{}, err
	}
	if err := staticprotocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return staticprotocol.PrepareResponse{}, err
	}
	response := envelope.Response
	return response, staticprotocol.ValidateResponse(response.ProtocolVersion, response.Method, staticprotocol.PrepareMethod)
}

func (w *syntaxCompilerWorker) NativeStaticFinalize(ctx context.Context, request staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error) {
	id := w.NextID()
	request.ID = id
	envelope, err := projectNativeStaticCall[staticprotocol.WorkerResponse[staticprotocol.FinalizeResponse]](ctx, w, request)
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	if err := staticprotocol.ValidateWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	response := envelope.Response
	return response, staticprotocol.ValidateResponse(response.ProtocolVersion, response.Method, staticprotocol.FinalizeMethod)
}

func (p *syntaxCompilerPool) NativeStaticPrepare(ctx context.Context, request staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return staticprotocol.PrepareResponse{}, err
	}
	return worker.NativeStaticPrepare(ctx, request)
}

func (p *syntaxCompilerPool) NativeStaticFinalize(ctx context.Context, request staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return worker.NativeStaticFinalize(ctx, request)
}

func projectNativeStaticCall[Resp any](ctx context.Context, worker *syntaxCompilerWorker, request any) (Resp, error) {
	var zero Resp
	if worker == nil || worker.Process() == nil {
		return zero, fmt.Errorf("project native static compiler is not configured")
	}
	return nodeworker.Call[Resp](ctx, worker.Process(), request)
}
