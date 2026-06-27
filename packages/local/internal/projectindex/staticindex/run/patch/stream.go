package patch

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type FinalizeStreamer interface {
	StaticIndexFinalizeStream(context.Context, protocol.FinalizeRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
}

type CompileStreamer interface {
	StaticIndexCompileStream(context.Context, protocol.CompileRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
}

func FromFinalizeStream(
	ctx context.Context,
	options Options,
	streamer FinalizeStreamer,
	request protocol.FinalizeRequest,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, protocol.FinalizeResponse, error) {
	request.Stream = true
	return fromStream(options, "Static Index finalize", func(handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
		return streamer.StaticIndexFinalizeStream(ctx, request, handle)
	})
}

func FromCompileStream(
	ctx context.Context,
	options Options,
	streamer CompileStreamer,
	request protocol.CompileRequest,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, protocol.FinalizeResponse, error) {
	request.Stream = true
	return fromStream(options, "Static Index compile", func(handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
		return streamer.StaticIndexCompileStream(ctx, request, handle)
	})
}

func fromStream(
	options Options,
	label string,
	stream func(protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error),
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, protocol.FinalizeResponse, error) {
	collector := NewCollector(options)
	eventCount := 0
	response, err := stream(func(event protocol.FinalizeStreamEvent) error {
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
