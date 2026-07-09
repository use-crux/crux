package qualitycmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"

	"github.com/use-crux/crux/packages/local/internal/domain"
)

type qualityRunStreamResult struct {
	exitCode int
	err      *qualityRunSummaryError
}

type qualityCollectStreamResult struct {
	manifests     []domain.QualityManifest
	collectErrors []domain.QualityCollectError
	exitCode      int
	err           *qualityRunSummaryError
}

func consumeQualityCollectStream(stdout io.Reader, wait func() error) qualityCollectStreamResult {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)

	result := qualityCollectStreamResult{exitCode: 2}
	sawCollectDone := false
	sawRunDone := false
	for scanner.Scan() {
		var ev domain.QualityEvent
		if json.Unmarshal(scanner.Bytes(), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "collect:done":
			sawCollectDone = true
			result.manifests = ev.Evaluations
			result.collectErrors = ev.Errors
		case "run:done":
			sawRunDone = true
			result.exitCode = ev.ExitCode
		}
	}
	scanErr := scanner.Err()
	waitErr := wait()
	if scanErr != nil {
		result.exitCode = 2
		result.err = &qualityRunSummaryError{Code: "worker-crash", Message: "quality runner stream failed: " + scanErr.Error()}
		return result
	}
	if !sawCollectDone {
		result.exitCode = 2
		result.err = &qualityRunSummaryError{Code: "worker-crash", Message: workerCrashMessage("missing collect:done", waitErr)}
		return result
	}
	if !sawRunDone {
		result.exitCode = 2
		result.err = &qualityRunSummaryError{Code: "worker-crash", Message: workerCrashMessage("missing terminal run:done", waitErr)}
		return result
	}
	if result.exitCode == 0 && waitErr != nil {
		result.exitCode = 2
		result.err = &qualityRunSummaryError{Code: "worker-crash", Message: "quality runner exited after reporting success: " + waitErr.Error()}
	}
	return result
}

func consumeQualityRunnerStream(
	stdout io.Reader,
	wait func() error,
	reporter *qualityReporter,
	forwarder *runEventForwarder,
) qualityRunStreamResult {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)

	exitCode := 2
	sawRunDone := false
	var terminalErr *qualityRunSummaryError
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var ev domain.QualityEvent
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		if forwarder != nil {
			forwarder.forward(line)
		}
		reporter.handle(&ev)
		if ev.Type == "run:done" {
			exitCode = ev.ExitCode
			sawRunDone = true
			if ev.RunError != nil {
				terminalErr = &qualityRunSummaryError{Code: ev.RunError.Code, Message: ev.RunError.Message}
			}
		}
	}
	scanErr := scanner.Err()
	waitErr := wait()

	if scanErr != nil {
		return synthesizeQualityRunnerCrash(reporter, "worker-crash", "quality runner stream failed: "+scanErr.Error())
	}
	if !sawRunDone {
		return synthesizeQualityRunnerCrash(reporter, "worker-crash", workerCrashMessage("missing terminal run:done", waitErr))
	}
	if exitCode == 0 && waitErr != nil {
		return synthesizeQualityRunnerCrash(reporter, "worker-crash", "quality runner exited after reporting success: "+waitErr.Error())
	}
	if terminalErr != nil {
		return qualityRunStreamResult{exitCode: exitCode, err: terminalErr}
	}
	return qualityRunStreamResult{exitCode: exitCode}
}

func workerCrashMessage(reason string, waitErr error) string {
	message := "quality runner crashed: " + reason
	if waitErr != nil {
		message = fmt.Sprintf("%s (%v)", message, waitErr)
	}
	return message
}

func synthesizeQualityRunnerCrash(reporter *qualityReporter, code string, message string) qualityRunStreamResult {
	if reporter != nil {
		reporter.handle(&domain.QualityEvent{
			Type:    "error",
			Scope:   "execute",
			Message: message,
		})
	}
	return qualityRunStreamResult{
		exitCode: 2,
		err:      &qualityRunSummaryError{Code: code, Message: message},
	}
}
