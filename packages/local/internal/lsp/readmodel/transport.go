package readmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// ProbeResult is a coherent server snapshot plus compatibility metadata.
type ProbeResult struct {
	Snapshot    Snapshot
	VersionSkew bool
}

// ProjectRootMismatchError identifies a healthy dev server for another repo.
type ProjectRootMismatchError struct {
	ServerRoot    string
	WorkspaceRoot string
}

func (e *ProjectRootMismatchError) Error() string {
	return fmt.Sprintf("dev server project root %q does not match workspace %q", e.ServerRoot, e.WorkspaceRoot)
}

// AttachTransport provides the HTTP and WebSocket operations used by attach
// mode. The HTTP client is injectable so tests use real in-process servers.
type AttachTransport struct {
	http *api.Client
}

// NewAttachTransport creates attach transport around a Crux API client.
func NewAttachTransport(client *api.Client) *AttachTransport {
	return &AttachTransport{http: client}
}

// Probe fetches the only endpoint that carries the project and process
// identity needed to safely attach.
func (t *AttachTransport) Probe(
	ctx context.Context,
	expectedRoot string,
	clientVersion string,
	budget time.Duration,
) (ProbeResult, error) {
	probeContext, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	snapshot, err := t.Snapshot(probeContext)
	if err != nil {
		return ProbeResult{}, err
	}
	return ValidateSnapshot(snapshot, expectedRoot, clientVersion)
}

// ValidateSnapshot verifies that a remote snapshot belongs to the expected
// workspace and reports transport-version compatibility metadata.
func ValidateSnapshot(snapshot Snapshot, expectedRoot, clientVersion string) (ProbeResult, error) {
	if snapshot.ProjectRoot == "" {
		return ProbeResult{}, fmt.Errorf("dev server Project Index has no project root identity")
	}
	wantRoot, err := filepath.Abs(expectedRoot)
	if err != nil {
		return ProbeResult{}, fmt.Errorf("resolve workspace root: %w", err)
	}
	gotRoot, err := filepath.Abs(snapshot.ProjectRoot)
	if err != nil {
		return ProbeResult{}, fmt.Errorf("resolve dev server project root: %w", err)
	}
	if filepath.Clean(gotRoot) != filepath.Clean(wantRoot) {
		return ProbeResult{}, &ProjectRootMismatchError{ServerRoot: gotRoot, WorkspaceRoot: wantRoot}
	}
	return ProbeResult{
		Snapshot: snapshot,
		VersionSkew: snapshot.ServerVersion == "" ||
			snapshot.ServerVersion != clientVersion || snapshot.Generation == nil,
	}, nil
}

// Snapshot fetches and decodes a coherent HTTP Project Index view while
// preserving whether generation metadata was present on the wire.
func (t *AttachTransport) Snapshot(ctx context.Context) (Snapshot, error) {
	if t == nil || t.http == nil {
		return Snapshot{}, fmt.Errorf("attach transport is not configured")
	}
	var raw json.RawMessage
	if err := t.http.GetJSON(ctx, "/api/index", &raw); err != nil {
		return Snapshot{}, err
	}
	return decodeSnapshot(raw)
}
