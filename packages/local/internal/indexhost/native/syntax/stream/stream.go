package syntaxstream

import (
	"context"
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/indexhost/indexwire"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax/record"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
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
	worker *nodeworker.Worker,
	req indexwire.Request,
	plan projectindex.ProjectStaticSyntaxPlan,
	parser syntax.StreamParser,
	handle func(json.RawMessage) error,
	done func() bool,
) (Timing, error) {
	var timing Timing
	var sendDoneAt time.Time
	err := nodeworker.StreamCallSession(ctx, worker, func(send nodeworker.StreamSender) error {
		var err error
		timing, err = Send(ctx, send, req, indexwire.NewID("index"), plan, parser)
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
	send nodeworker.StreamSender,
	req indexwire.Request,
	requestID string,
	plan projectindex.ProjectStaticSyntaxPlan,
	parser syntax.StreamParser,
) (Timing, error) {
	parseRequests := record.ParseRequests(plan)
	var timing Timing
	parseStarted := time.Now()
	if err := send(indexwire.Start(req, requestID)); err != nil {
		return timing, err
	}
	chunker := indexwire.NewRecordChunker(func(records []json.RawMessage) error {
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
	if err := send(indexwire.Request{
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
