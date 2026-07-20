package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestDevServerShutdownContextCancelsAndJoinsTunnelStartup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	stopped := make(chan struct{})
	server := &DevServer{
		ctx:     ctx,
		cancel:  cancel,
		tunnel:  true,
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		workers: &devServerWorkers{},
		startTunnel: func(ctx context.Context, _ *slog.Logger) (*TunnelResult, error) {
			close(started)
			<-ctx.Done()
			close(stopped)
			return nil, ctx.Err()
		},
	}
	reported := make(chan TunnelStartupResult, 1)

	server.StartTunnel(context.Background(), func(result TunnelStartupResult) {
		reported <- result
	})
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("tunnel startup did not begin")
	}
	cancel()
	waitCtx, stopWaiting := context.WithTimeout(context.Background(), time.Second)
	defer stopWaiting()
	if err := server.workers.Wait(waitCtx); err != nil {
		t.Fatalf("wait for tunnel worker: %v", err)
	}
	select {
	case <-stopped:
	default:
		t.Fatal("server cancellation did not reach tunnel startup")
	}
	select {
	case result := <-reported:
		if !errors.Is(result.Err, context.Canceled) {
			t.Fatalf("startup result error = %v, want context cancellation", result.Err)
		}
	default:
		t.Fatal("server cancellation did not report a terminal startup result")
	}
}

func TestDevServerReportsTunnelStartupFailure(t *testing.T) {
	want := errors.New("tunnel unavailable")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := &DevServer{
		ctx:     ctx,
		cancel:  cancel,
		tunnel:  true,
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		workers: &devServerWorkers{},
		startTunnel: func(context.Context, *slog.Logger) (*TunnelResult, error) {
			return nil, want
		},
	}
	reported := make(chan TunnelStartupResult, 1)

	server.StartTunnel(context.Background(), func(result TunnelStartupResult) {
		reported <- result
	})
	select {
	case result := <-reported:
		if !errors.Is(result.Err, want) {
			t.Fatalf("startup result error = %v, want %v", result.Err, want)
		}
	case <-time.After(time.Second):
		t.Fatal("tunnel startup failure was not reported")
	}
}
