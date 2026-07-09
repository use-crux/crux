package qualitycmd

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestConsumeQualityRunnerStreamSynthesizesWorkerCrashWithoutRunDone(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	reporter := newQualityReporter(&qualityRunOpts{jsonStdout: true}, io, 4400)

	result := consumeQualityRunnerStream(
		strings.NewReader(`{"type":"eval:start","runId":"01KTCRASH","evaluationId":"eval.crash","cells":1}`+"\n"),
		func() error { return errors.New("exit status 2") },
		reporter,
		nil,
	)

	if result.exitCode != 2 || result.err == nil || result.err.Code != "worker-crash" {
		t.Fatalf("result = %+v, want structured worker crash", result)
	}
	if result.err.Message == "" || !strings.Contains(result.err.Message, "missing terminal run:done") {
		t.Fatalf("crash message = %q", result.err.Message)
	}
}

func TestConsumeQualityRunnerStreamTrustsTerminalRunDoneForRunFailures(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	reporter := newQualityReporter(&qualityRunOpts{jsonStdout: true}, io, 4400)

	result := consumeQualityRunnerStream(
		strings.NewReader(`{"type":"run:done","runId":"01KTFAIL","experiments":["exp"],"exitCode":1}`+"\n"),
		func() error { return errors.New("exit status 1") },
		reporter,
		nil,
	)

	if result.exitCode != 1 || result.err != nil {
		t.Fatalf("result = %+v, want normal run failure from terminal event", result)
	}
}
