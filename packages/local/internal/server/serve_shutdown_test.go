package server

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNewDevServerDerivesOwnedWorkFromParentContext(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	opts := devServerTestOptions(t, findFreePort())
	opts.Context = parent
	opts.ProjectIndexer = fakeProjectIndexer{}
	srv := NewDevServer(opts)
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })
	cancel()

	select {
	case <-srv.ctx.Done():
		if !errors.Is(srv.ctx.Err(), context.Canceled) {
			t.Fatalf("server context error = %v, want parent cancellation", srv.ctx.Err())
		}
	case <-time.After(time.Second):
		t.Fatal("parent cancellation did not reach the server-owned context")
	}
}

func TestDevServerWorkersRejectAdmissionAfterClose(t *testing.T) {
	workers := &devServerWorkers{}
	release := make(chan struct{})
	if !workers.Go(func() { <-release }) {
		t.Fatal("initial worker was rejected")
	}
	workers.Close()
	lateWorkerRan := make(chan struct{})
	if workers.Go(func() { close(lateWorkerRan) }) {
		t.Fatal("worker was admitted after shutdown closed admission")
	}
	close(release)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := workers.Wait(ctx); err != nil {
		t.Fatalf("wait for admitted worker: %v", err)
	}
	select {
	case <-lateWorkerRan:
		t.Fatal("rejected worker ran")
	default:
	}
}

func TestDevServerShutdownDisconnectsWebSockets(t *testing.T) {
	port := findFreePort()
	srv := NewDevServer(devServerTestOptions(t, port))
	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	wsURL := url.URL{Scheme: "ws", Host: fmt.Sprintf("localhost:%d", port), Path: "/ws/ui"}
	client, _, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown() error: %v", err)
	}
	client.SetReadDeadline(time.Now().Add(time.Second))
	assertWebSocketClosed(t, client)
}

func TestDevServerShutdownReleasesListener(t *testing.T) {
	port := findFreePort()
	srv := NewDevServer(devServerTestOptions(t, port))
	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if err := srv.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown() error: %v", err)
	}
	if !IsPortAvailable(port) {
		t.Fatalf("port %d remained occupied after Shutdown", port)
	}
}

func TestDevServerCannotStartOrLeakListenerAfterShutdown(t *testing.T) {
	port := findFreePort()
	srv := NewDevServer(devServerTestOptions(t, port))
	if err := srv.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown() error: %v", err)
	}
	if err := srv.Start(); err == nil {
		t.Fatal("Start() after shutdown succeeded")
	}
	if !IsPortAvailable(port) {
		t.Fatalf("Start() after shutdown leaked listener on port %d", port)
	}
}

func TestDevServerShutdownRunsOwnedCleanupOnceAndCachesItsError(t *testing.T) {
	srv := NewDevServer(devServerTestOptions(t, findFreePort()))
	expected := errors.New("runtime worker close failed")
	var closes atomic.Int32
	srv.closeRuntimeArtifacts = func() error {
		closes.Add(1)
		return expected
	}

	const callers = 16
	errs := make(chan error, callers)
	var callersDone sync.WaitGroup
	callersDone.Add(callers)
	for range callers {
		go func() {
			defer callersDone.Done()
			errs <- srv.Shutdown(context.Background())
		}()
	}
	callersDone.Wait()
	close(errs)

	for err := range errs {
		if !errors.Is(err, expected) {
			t.Fatalf("Shutdown() error = %v, want cached %v", err, expected)
		}
	}
	if got := closes.Load(); got != 1 {
		t.Fatalf("runtime cleanup calls = %d, want 1", got)
	}
}
