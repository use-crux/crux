package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const (
	canonicalEvidenceChildEnv = "CRUX_EVIDENCE_E2E_CHILD"
	canonicalEvidenceDBEnv    = "CRUX_EVIDENCE_E2E_DB"
	canonicalEvidenceNowEnv   = "CRUX_EVIDENCE_E2E_NOW"
	canonicalEvidenceReadyEnv = "CRUX_EVIDENCE_E2E_READY"
	canonicalEvidenceAddrEnv  = "CRUX_EVIDENCE_E2E_ADDR"
	canonicalEvidenceSeedEnv  = "CRUX_EVIDENCE_E2E_SEED"
)

type canonicalEvidenceProcess struct {
	baseURL string
	command *exec.Cmd
	logs    *bytes.Buffer
}

func startCanonicalEvidenceProcess(
	t *testing.T,
	databasePath string,
	now time.Time,
) *canonicalEvidenceProcess {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	readyPath := filepath.Join(t.TempDir(), "ready")
	logs := &bytes.Buffer{}
	command := exec.Command(
		executable,
		"-test.run=^TestEvidenceCanonicalRestartProcess$",
		"-test.v",
	)
	command.Env = append(os.Environ(),
		canonicalEvidenceChildEnv+"=1",
		canonicalEvidenceDBEnv+"="+databasePath,
		canonicalEvidenceNowEnv+"="+now.UTC().Format(time.RFC3339Nano),
		canonicalEvidenceReadyEnv+"="+readyPath,
		"CRUX_OBSERVABILITY_RETENTION_DAYS=14",
		"CRUX_EVIDENCE_RETENTION_DAYS=2",
		"CRUX_EVIDENCE_PAYLOAD_RETENTION_DAYS=1",
	)
	command.Stdout = logs
	command.Stderr = logs
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	process := &canonicalEvidenceProcess{command: command, logs: logs}
	t.Cleanup(func() { process.stop(t) })

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		raw, readErr := os.ReadFile(readyPath)
		if readErr == nil && len(raw) > 0 {
			process.baseURL = string(raw)
			return process
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Local child did not become ready:\n%s", logs.String())
	return nil
}

func (process *canonicalEvidenceProcess) stop(t *testing.T) {
	t.Helper()
	if process == nil || process.command == nil ||
		process.command.Process == nil {
		return
	}
	if err := process.command.Process.Signal(os.Interrupt); err != nil &&
		!errors.Is(err, os.ErrProcessDone) {
		t.Fatalf("interrupt Local child: %v\n%s", err, process.logs.String())
	}
	if err := process.command.Wait(); err != nil {
		t.Fatalf("wait for Local child: %v\n%s", err, process.logs.String())
	}
	process.command = nil
}

func TestEvidenceCanonicalRestartProcess(t *testing.T) {
	if os.Getenv(canonicalEvidenceChildEnv) != "1" {
		t.Skip("process helper")
	}
	now, err := time.Parse(
		time.RFC3339Nano,
		os.Getenv(canonicalEvidenceNowEnv),
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	service, err := observability.OpenServiceWithOptions(
		ctx,
		os.Getenv(canonicalEvidenceDBEnv),
		observability.OpenServiceOptions{
			Now: func() time.Time { return now },
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	registerCanonicalEvidenceDirectRoute(
		mux,
		devtools.NewDirectClient(store.NewStore()).WithObservability(service),
	)
	listenAddress := os.Getenv(canonicalEvidenceAddrEnv)
	if listenAddress == "" {
		listenAddress = "127.0.0.1:0"
	}
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: mux}
	serveError := make(chan error, 1)
	go func() { serveError <- server.Serve(listener) }()

	baseURL := "http://" + listener.Addr().String()
	if os.Getenv(canonicalEvidenceSeedEnv) == "1" {
		assertCanonicalEvidenceDispositions(
			t,
			postCanonicalEvidenceBatch(
				t,
				baseURL,
				canonicalEvidenceLifecycleRecords(),
			),
			0,
		)
		assertCanonicalEvidenceDispositions(
			t,
			postCanonicalEvidenceBatch(
				t,
				baseURL,
				canonicalEvidenceRelationshipRecords(),
			),
			1,
		)
	}
	if err := os.WriteFile(
		os.Getenv(canonicalEvidenceReadyEnv),
		[]byte(baseURL),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	<-ctx.Done()
	shutdownContext, cancel := context.WithTimeout(
		context.Background(),
		3*time.Second,
	)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		t.Fatal(err)
	}
	if err := <-serveError; err != nil && !errors.Is(err, http.ErrServerClosed) {
		t.Fatal(err)
	}
}

func registerCanonicalEvidenceDirectRoute(
	mux *http.ServeMux,
	client *devtools.DirectClient,
) {
	mux.HandleFunc(
		"POST /__e2e/direct/evidence",
		func(w http.ResponseWriter, request *http.Request) {
			var input observability.EvidenceInspectRequest
			if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
				http.Error(w, "invalid request", http.StatusBadRequest)
				return
			}
			result, err := client.InspectEvidence(request.Context(), input)
			if err != nil {
				http.Error(
					w,
					fmt.Sprintf("direct evidence inspection failed: %v", err),
					http.StatusInternalServerError,
				)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(result)
		},
	)
}
