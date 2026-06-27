package syntaxstream

import (
	"context"
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax/record"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

type Timing struct {
	ParseAndForwardMs float64
	ProjectionMs      float64
	RecordCount       int
	RecordBytes       int
	ChunkCount        int
	MaxChunkBytes     int
}

func Stream(
	ctx context.Context,
	worker *workerproc.Worker,
	req requestwire.Request,
	plan projectindex.ProjectStaticSyntaxPlan,
	parser syntax.StreamParser,
	handle func(json.RawMessage) error,
	done func() bool,
) (Timing, error) {
	var timing Timing
	var sendDoneAt time.Time
	err := workerproc.StreamCallSession(ctx, worker, func(send workerproc.StreamSender) error {
		var err error
		timing, err = Send(ctx, send, req, requestwire.NewID("index"), plan, parser)
		sendDoneAt = time.Now()
		return err
	}, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
	if !sendDoneAt.IsZero() {
		timing.ProjectionMs = elapsedMs(sendDoneAt)
	}
	return timing, err
}

func Send(
	ctx context.Context,
	send workerproc.StreamSender,
	req requestwire.Request,
	requestID string,
	plan projectindex.ProjectStaticSyntaxPlan,
	parser syntax.StreamParser,
) (Timing, error) {
	parseRequests := record.ParseRequests(plan)
	var timing Timing
	parseStarted := time.Now()
	if err := send(requestwire.Start(req, requestID)); err != nil {
		return timing, err
	}
	chunker := requestwire.NewRecordChunker(func(records []json.RawMessage) error {
		timing.ChunkCount++
		chunkBytes := 0
		for _, record := range records {
			chunkBytes += len(record)
		}
		if chunkBytes > timing.MaxChunkBytes {
			timing.MaxChunkBytes = chunkBytes
		}
		return send(syntax.RecordBatchRequestLine(req.Method, requestID, records))
	})
	if err := parser.ParseFilesStream(ctx, parseRequests, func(_ int, record json.RawMessage) error {
		timing.RecordCount++
		timing.RecordBytes += len(record)
		return chunker.Add(record)
	}); err != nil {
		return timing, err
	}
	if err := chunker.Flush(); err != nil {
		return timing, err
	}
	if err := send(requestwire.Request{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     "done",
	}); err != nil {
		return timing, err
	}
	timing.ParseAndForwardMs = elapsedMs(parseStarted)
	return timing, nil
}

func elapsedMs(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}
