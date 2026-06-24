package staticpatch

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

type FinalizeStreamer interface {
	NativeStaticFinalizeStream(context.Context, staticprotocol.FinalizeRequest, staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error)
}

type CompileStreamer interface {
	NativeStaticCompileStream(context.Context, staticprotocol.CompileRequest, staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error)
}

func FromFinalizeStream(
	ctx context.Context,
	options Options,
	streamer FinalizeStreamer,
	request staticprotocol.FinalizeRequest,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, staticprotocol.FinalizeResponse, error) {
	request.Stream = true
	return fromStream(options, "native static finalize", func(handle staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error) {
		return streamer.NativeStaticFinalizeStream(ctx, request, handle)
	})
}

func FromCompileStream(
	ctx context.Context,
	options Options,
	streamer CompileStreamer,
	request staticprotocol.CompileRequest,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, staticprotocol.FinalizeResponse, error) {
	request.Stream = true
	return fromStream(options, "native static compile", func(handle staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error) {
		return streamer.NativeStaticCompileStream(ctx, request, handle)
	})
}

func fromStream(
	options Options,
	label string,
	stream func(staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error),
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, staticprotocol.FinalizeResponse, error) {
	collector := NewCollector(options)
	eventCount := 0
	response, err := stream(func(event staticprotocol.FinalizeStreamEvent) error {
		eventCount++
		return collector.Handle(event.Event)
	})
	if err != nil {
		return projectindex.IndexPatch{}, nil, false, response, err
	}
	if eventCount == 0 {
		return projectindex.IndexPatch{}, nil, false, response, nil
	}

	patch, timings, complete, err := Result(collector, label)
	return patch, timings, complete, response, err
}
