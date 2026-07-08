package qualitycmd

import (
	"errors"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestQualityDiffCommandRequiresJSONFlag(t *testing.T) {
	cmd := NewQualityDiffCmd(&cli.Factory{})
	flag := cmd.Flags().Lookup("json")
	if flag == nil {
		t.Fatal("quality diff is missing --json")
	}
	if flag.Value.Type() != "bool" {
		t.Fatalf("--json should be a bool flag, got %q", flag.Value.Type())
	}
}

func TestConsumeQualityDiffStreamReturnsDiffEvent(t *testing.T) {
	stream := strings.NewReader(strings.Join([]string{
		`{"type":"diff:done","diff":{"schemaVersion":1,"a":{"experimentId":"a"},"b":{"experimentId":"b"}}}`,
		`{"type":"run:done","experiments":[],"exitCode":0}`,
		``,
	}, "\n"))

	result := consumeQualityDiffStream(stream, func() error { return nil })

	if result.err != nil {
		t.Fatalf("consumeQualityDiffStream error: %v", result.err)
	}
	if result.exitCode != 0 {
		t.Fatalf("exitCode = %d, want 0", result.exitCode)
	}
	if !strings.Contains(string(result.diff), `"schemaVersion":1`) {
		t.Fatalf("diff = %s", result.diff)
	}
}

func TestConsumeQualityDiffStreamPreservesWorkerError(t *testing.T) {
	stream := strings.NewReader(`{"type":"run:done","experiments":[],"exitCode":2,"error":{"message":"boom"}}` + "\n")

	result := consumeQualityDiffStream(stream, func() error { return errors.New("process exit 2") })

	if result.err == nil || !strings.Contains(result.err.Error(), "boom") {
		t.Fatalf("err = %v, want worker message", result.err)
	}
	if result.exitCode != 2 {
		t.Fatalf("exitCode = %d, want 2", result.exitCode)
	}
}
