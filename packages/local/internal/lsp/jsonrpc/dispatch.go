package jsonrpc

import (
	"context"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// dispatch serializes preflight while allowing explicitly deferred work to
// complete out of order. The writer remains the sole owner of framed output.
func dispatch(
	ctx context.Context,
	handler Handler,
	requests <-chan protocol.Request,
	responses chan<- []byte,
	stop chan<- struct{},
	done chan<- struct{},
) {
	var pending sync.WaitGroup
	defer func() {
		pending.Wait()
		close(done)
	}()
	for request := range requests {
		result := handler.Handle(ctx, request)
		if result.Deferred != nil {
			pending.Add(1)
			go func(request protocol.Request, deferred func() HandlerResult) {
				defer pending.Done()
				writeHandlerResult(ctx, request, deferred(), responses, stop)
			}(request, result.Deferred)
			continue
		}
		if !writeHandlerResult(ctx, request, result, responses, stop) {
			return
		}
	}
}

func writeHandlerResult(
	ctx context.Context,
	request protocol.Request,
	result HandlerResult,
	responses chan<- []byte,
	stop chan<- struct{},
) bool {
	if !request.IsNotification() {
		response, err := resultResponse(request.ID, result)
		if err != nil {
			response = errorResponse(request.ID, protocol.InternalErrorCode, "Internal error")
		}
		if err := queueResponse(ctx, responses, response); err != nil {
			return false
		}
	}
	if result.Stop {
		select {
		case stop <- struct{}{}:
		case <-ctx.Done():
		}
		return false
	}
	return true
}
