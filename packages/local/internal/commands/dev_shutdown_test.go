package commands

import (
	"bytes"
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
)

func TestDevPlainReturnsCleanupErrorAndRunsShutdownOnce(t *testing.T) {
	want := errors.New("cleanup failed")
	session := &shutdownTestServer{err: want}
	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning:    func(int) bool { return false },
		portAvailable:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
		newServer: func(server.DevServerOptions) devServerSession {
			return session
		},
	})
	cmd.SetArgs([]string{"--no-tui"})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := cmd.ExecuteContext(ctx)
	if !errors.Is(err, want) {
		t.Fatalf("dev error = %v, want cleanup error", err)
	}
	if calls := session.calls.Load(); calls != 1 {
		t.Fatalf("shutdown calls = %d, want 1", calls)
	}
}

type shutdownTestServer struct {
	fakeDevServerSession
	calls atomic.Int32
	err   error
}

func (server *shutdownTestServer) Shutdown(context.Context) error {
	server.calls.Add(1)
	return server.err
}
