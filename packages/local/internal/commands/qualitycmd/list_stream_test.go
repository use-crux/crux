package qualitycmd

import (
	"errors"
	"strings"
	"testing"
)

func TestConsumeQualityCollectStreamRejectsMissingCollectDone(t *testing.T) {
	result := consumeQualityCollectStream(
		strings.NewReader(`{"type":"error","scope":"collect","message":"boom"}`+"\n"),
		func() error { return errors.New("exit status 2") },
	)

	if result.exitCode != 2 || result.err == nil || result.err.Code != "worker-crash" {
		t.Fatalf("result = %+v, want worker-crash exit 2", result)
	}
	if len(result.manifests) != 0 || !strings.Contains(result.err.Message, "missing collect:done") {
		t.Fatalf("result = %+v, want no manifests and missing collect diagnostic", result)
	}
}
