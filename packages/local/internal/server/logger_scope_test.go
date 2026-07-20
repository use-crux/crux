package server

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type failingResponseWriter struct {
	header http.Header
}

func (w *failingResponseWriter) Header() http.Header { return w.header }

func (*failingResponseWriter) Write([]byte) (int, error) { return 0, errors.New("write failed") }

func (*failingResponseWriter) WriteHeader(int) {}

func TestHTTPServerRoutesWebSocketDiagnosticsToItsLogger(t *testing.T) {
	previous := slog.Default()
	var processLogs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&processLogs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	var serverLogs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&serverLogs, nil))
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	storage := store.NewStore()
	inspectService := inspect.NewService(storage, inspect.Dir(t.TempDir()))
	handler := NewHTTPServerWithServicesContext(
		ctx,
		devtools.NewService(storage, inspectService),
		ServerOptions{Logger: logger},
	)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/ws/ui", nil))
	runtimeResponse := httptest.NewRecorder()
	handler.ServeHTTP(runtimeResponse, httptest.NewRequest("GET", "/ws/runtime", nil))

	for _, diagnostic := range []string{
		"websocket upgrade failed",
		"runtime bridge websocket upgrade failed",
	} {
		if !strings.Contains(serverLogs.String(), diagnostic) {
			t.Errorf("server logs = %q, want %q", serverLogs.String(), diagnostic)
		}
		if strings.Contains(processLogs.String(), diagnostic) {
			t.Errorf("server diagnostic %q escaped to process logger: %q", diagnostic, processLogs.String())
		}
	}
}

func TestWriteJSONRoutesDiagnosticsToItsLogger(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))

	writeJSON(logger, &failingResponseWriter{header: make(http.Header)}, map[string]string{"status": "ok"})

	if !strings.Contains(logs.String(), "JSON encode error") {
		t.Fatalf("server logs = %q, want JSON encode diagnostic", logs.String())
	}
}

func TestEnvFileDiagnosticsUseTheTunnelLogger(t *testing.T) {
	previous := slog.Default()
	var processLogs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&processLogs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	const key = "CRUX_TUNNEL_LOGGER_SCOPE_TEST"
	t.Setenv(key, "")
	envFile := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(envFile, []byte(key+"=loaded\n"), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	var tunnelLogs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&tunnelLogs, &slog.HandlerOptions{Level: slog.LevelDebug}))

	loadSingleEnvFile(envFile, logger)

	if got := os.Getenv(key); got != "loaded" {
		t.Fatalf("loaded env = %q, want loaded", got)
	}
	const diagnostic = "loaded env file"
	if !strings.Contains(tunnelLogs.String(), diagnostic) {
		t.Fatalf("tunnel logs = %q, want %q", tunnelLogs.String(), diagnostic)
	}
	if strings.Contains(processLogs.String(), diagnostic) {
		t.Fatalf("tunnel diagnostic escaped to process logger: %q", processLogs.String())
	}
}
