package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func tailTraces(io *output.IO, ctx context.Context, c *api.Client, promptFilter, sessionFilter string, jsonOut bool) error {
	ws, err := c.ConnectWebSocket(ctx)
	if err != nil {
		return err
	}
	defer ws.Close()

	existing, err := c.ObservabilityRuns(ctx)
	if err != nil {
		existing = nil
	}
	existing = filterObservabilityRuns(existing, promptFilter, sessionFilter)

	seenIDs := map[string]bool{}
	if !jsonOut {
		fmt.Fprintln(io.Out, brandedHeader(io, "traces")+"  "+io.Sprint(output.Dim, "(tailing — Ctrl+C to stop)"))
		fmt.Fprintln(io.Out)
	}
	for _, run := range existing {
		seenIDs[run.RunID] = true
		if err := writeObservabilityRun(io, run, jsonOut); err != nil {
			return err
		}
	}

	ch := make(chan json.RawMessage, 100)
	go ws.ReadMessages(ch)

	for {
		select {
		case <-ctx.Done():
			return nil
		case _, ok := <-ch:
			if !ok {
				return nil
			}
			runs, err := c.ObservabilityRuns(ctx)
			if err != nil {
				continue
			}
			runs = filterObservabilityRuns(runs, promptFilter, sessionFilter)

			for _, run := range runs {
				if seenIDs[run.RunID] {
					continue
				}
				seenIDs[run.RunID] = true
				if run.Status == "running" {
					continue
				}
				if err := writeObservabilityRun(io, run, jsonOut); err != nil {
					return err
				}
			}

			time.Sleep(100 * time.Millisecond)
		}
	}
}

func writeObservabilityRun(io *output.IO, run api.ObservabilityRunSummary, jsonOut bool) error {
	if jsonOut {
		return io.WriteJSON(run)
	}
	printObservabilityRunLine(io, run)
	return nil
}
