//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

// TestSystemdContainmentIntegration is intentionally a real system-bus test.
// It uses the packaged runner and a canonical DOCX, but does not register any
// public format route. The environment gate makes it safe to keep in normal
// Go test runs while CI turns missing systemd support into a hard failure.
func TestSystemdContainmentIntegration(t *testing.T) {
	requireSystemdIntegration(t)
	if os.Geteuid() != 0 {
		t.Fatal("systemd containment integration requires root on the system bus")
	}
	if _, err := os.Stat("/run/dbus/system_bus_socket"); err != nil {
		t.Fatalf("system bus unavailable: %v", err)
	}

	input, err := loadSystemdFixture(os.Getenv("CRUX_SYSTEMD_FIXTURE_PATH"))
	if err != nil {
		t.Fatal(err)
	}
	launch, err := PrepareLocalHost()
	if err != nil {
		t.Fatalf("prepare embedded Anydoc runtime and attested Node: %v", err)
	}
	t.Cleanup(func() { makeWritableTree(t, launch.runtimeRoot) })

	root, err := os.MkdirTemp("/run", "crux-anydoc-integration-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	stagingRoot := filepath.Join(root, "input")
	privateTemp := filepath.Join(root, "private")
	for _, path := range []string{stagingRoot, privateTemp} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	backend := NewSystemdBackend()
	supervisor := NewWithStager(backend, NewStager(stagingRoot))
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	run, err := supervisor.startEvaluation(ctx, input, FormatDOCX, launch, privateTemp, Limits{
		MemoryMax:       128 << 20,
		TasksMax:        TasksCeiling,
		CPUQuotaPercent: 50,
		RuntimeMax:      20 * time.Second,
	})
	if err != nil {
		t.Fatal(safeContainmentDiagnostic(err))
	}

	if err := run.Authorize(); err != nil {
		_ = run.Finish(context.Background(), err)
		t.Fatalf("authorize one-shot job: %s", safeContainmentDiagnostic(err))
	}
	result, err := run.Execute(ctx)
	if err != nil {
		t.Fatalf("execute packaged runner: %s", safeExecutionFailure(err, run.TerminalReport()))
	}
	if !result.OK || result.Accounting == nil || result.Accounting.SourceBytes != int64(len(input)) || result.SourceSHA256 != sha256Hex(input) || result.Format != "docx" {
		t.Fatalf("unbound or invalid runner result: %#v", result)
	}
	assertIntegrationCleanup(t, root, stagingRoot, privateTemp, run)
	hostile := runHostileContainmentCases(t, launch, root)
	writeContainmentEvidence(t, result, run.TerminalReport(), hostile)
}

func safeRunnerDiagnostic(err error, terminal TerminalReport) string {
	outcome := string(terminal.Outcome)
	switch terminal.Outcome {
	case ErrTimeout, ErrWorkerCrash, ErrContainmentUnavailable, ErrAborted:
	default:
		outcome = "unknown"
	}
	serviceResult := terminal.PreStop.ServiceResult
	switch serviceResult {
	case "success", "timeout", "oom-kill", "signal", "exit-code", "core-dump", "resources":
	default:
		serviceResult = "unknown"
	}
	oomKilled := terminal.PreStop.MemoryEvents["oom_kill"] > 0
	pidsLimited := terminal.PreStop.PIDsEvents["max"] > 0
	return "error=" + safeExecutionError(err) + " outcome=" + outcome + " service=" + serviceResult + " stage=" + safeRunnerStage(terminal.PreStop.ExecMainStatus) + " oom-killed=" + strconv.FormatBool(oomKilled) + " pids-limited=" + strconv.FormatBool(pidsLimited)
}

func safeExecutionError(err error) string {
	var supervisorError *SupervisorError
	if errors.As(err, &supervisorError) {
		switch supervisorError.Code {
		case ErrTimeout, ErrWorkerCrash, ErrContainmentUnavailable, ErrAborted:
			return string(supervisorError.Code)
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline"
	}
	return "unknown"
}

func safeContainmentDiagnostic(err error) string {
	const unavailable = "containment-unavailable"

	var supervisorError *SupervisorError
	if !errors.As(err, &supervisorError) || supervisorError.Code != ErrContainmentUnavailable {
		return unavailable
	}

	var containmentError *ContainmentError
	if !errors.As(err, &containmentError) || !validContainmentStage(containmentError.Stage) || !validContainmentReason(containmentError.ReasonCode) {
		return unavailable
	}

	return unavailable + " stage=" + containmentError.Stage + " reason=" + containmentError.ReasonCode
}

type fakeValidationUnit struct {
	validationErr  error
	execMainStatus int
	serviceResult  string
}

func (f *fakeValidationUnit) Report(ctx context.Context) (SandboxReport, error) {
	return SandboxReport{ExecMainStatus: f.execMainStatus, ServiceResult: f.serviceResult}, nil
}
func (f *fakeValidationUnit) CPUUsage(ctx context.Context) (time.Duration, error) { return 0, nil }
func (f *fakeValidationUnit) Stop(ctx context.Context) error                      { return nil }
func (f *fakeValidationUnit) WaitInactive(ctx context.Context) error              { return nil }
func (f *fakeValidationUnit) TerminalStatus(ctx context.Context) (TerminalStatus, error) {
	return TerminalStatus{State: "inactive", ServiceResult: f.serviceResult, ExecMainStatus: f.execMainStatus}, nil
}
func (f *fakeValidationUnit) TerminationEvidence(_ context.Context, _ string) (TerminationEvidence, error) {
	return TerminationEvidence{Empty: true}, nil
}
func (f *fakeValidationUnit) Cleanup(ctx context.Context) error { return nil }
func (f *fakeValidationUnit) ReceiveResult(ctx context.Context, _ Request) (Result, error) {
	return Result{}, closedWith(ErrInvalidResult, f.validationErr)
}
func (f *fakeValidationUnit) CaptureTerminalAccounting(ctx context.Context) (SandboxReport, time.Duration, accountingCaptureFailure, error) {
	return SandboxReport{ExecMainStatus: f.execMainStatus, ServiceResult: f.serviceResult}, 0, accountingCaptureOK, nil
}

func TestExecutePreservesHostResultValidationWithTerminalAckStatus(t *testing.T) {
	fake := &fakeValidationUnit{
		validationErr:  resultValidation("request-binding", "mismatch"),
		execMainStatus: 76,
		serviceResult:  "exit-code",
	}

	tmpDir := t.TempDir()
	stagingRoot := filepath.Join(tmpDir, "input")
	if err := os.Mkdir(stagingRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	stager := NewStager(stagingRoot)
	staged, err := stager.Stage([]byte("test"), 1024)
	if err != nil {
		t.Fatal(err)
	}

	_, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}

	limits := testJobLimits()
	sourceSHA := sha256Hex([]byte("test"))
	r := &Run{
		unit:        fake,
		write:       write,
		nonce:       "00000000000000000000000000000000",
		digest:      requestDigest(ProtocolVersion, "00000000000000000000000000000000", "docx", sourceSHA, 4, limits),
		sourceSHA:   sourceSHA,
		sourceBytes: 4,
		format:      "docx",
		limits:      limits,
		staged:      staged,
		stop:        make(chan struct{}),
		finished:    make(chan struct{}),
		started:     time.Now(),
	}

	ctx := context.Background()
	result, execErr := r.Execute(ctx)

	var validation *ResultValidationError
	if !errors.As(execErr, &validation) {
		t.Fatalf("Execute did not preserve ResultValidationError: %T %v", execErr, validation)
	}
	if validation.Stage != "request-binding" || validation.ReasonCode != "mismatch" {
		t.Fatalf("Execute stripepd validation: stage=%q reason=%q", validation.Stage, validation.ReasonCode)
	}
	if result.Request != (Request{}) {
		t.Fatalf("Execute returned a result on validation failure: %#v", result)
	}

	terminal := r.TerminalReport()
	if terminal.Outcome != ErrInvalidResult {
		t.Fatalf("terminal outcome = %q, want %q", terminal.Outcome, ErrInvalidResult)
	}

	got := safeExecutionFailure(execErr, terminal)
	const want = "error=invalid-result outcome=invalid-result service=exit-code stage=request-binding reason=mismatch oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
	if strings.Contains(got, "acknowledgement") {
		t.Fatalf("worker ack status %d masked host validation: %q", fake.execMainStatus, got)
	}

	unsafe := "/private/path nonce=secret input=customer.docx"
	for _, bad := range []error{
		closedWith(ErrInvalidResult, &ResultValidationError{Stage: unsafe, ReasonCode: "mismatch"}),
		closedWith(ErrInvalidResult, &ResultValidationError{Stage: "request-binding", ReasonCode: unsafe}),
		closedWith(ErrInvalidResult, errors.New(unsafe)),
	} {
		got := safeExecutionFailure(outcomeCode(bad), terminal)
		if strings.Contains(got, unsafe) || strings.Contains(got, "private") || strings.Contains(got, "secret") || strings.Contains(got, "customer") {
			t.Fatalf("diagnostic leaked unsafe details: %q", got)
		}
	}
}

func TestSafeExecutionFailurePreservesHostResultValidationOverAckStage(t *testing.T) {
	// Host rejected the worker result before ACK; the worker can still exit at
	// acknowledgement (76). Diagnostics must keep the fixed host stage/reason.
	err := closedWith(ErrInvalidResult, resultValidation("request-binding", "mismatch"))
	preserved := outcomeCode(err)

	var validation *ResultValidationError
	if !errors.As(preserved, &validation) {
		t.Fatalf("outcomeCode/Finish dropped ResultValidationError: %T %v", preserved, preserved)
	}
	if validation.Stage != "request-binding" || validation.ReasonCode != "mismatch" {
		t.Fatalf("validation codes = %q/%q", validation.Stage, validation.ReasonCode)
	}

	terminal := TerminalReport{
		Outcome: errorCode(preserved),
		PreStop: SandboxReport{
			ExecMainStatus: 76,
			ServiceResult:  "exit-code",
		},
	}
	got := safeExecutionFailure(preserved, terminal)
	const want = "error=invalid-result outcome=invalid-result service=exit-code stage=request-binding reason=mismatch oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
	if strings.Contains(got, "acknowledgement") {
		t.Fatalf("worker ack stage masked host validation: %q", got)
	}

	unsafe := "/private/path nonce=secret input=customer.docx"
	for _, bad := range []error{
		closedWith(ErrInvalidResult, &ResultValidationError{Stage: unsafe, ReasonCode: "mismatch"}),
		closedWith(ErrInvalidResult, &ResultValidationError{Stage: "request-binding", ReasonCode: unsafe}),
		closedWith(ErrInvalidResult, errors.New(unsafe)),
	} {
		got := safeExecutionFailure(outcomeCode(bad), terminal)
		if strings.Contains(got, unsafe) || strings.Contains(got, "private") || strings.Contains(got, "secret") || strings.Contains(got, "customer") {
			t.Fatalf("diagnostic leaked unsafe details: %q", got)
		}
	}
}

func TestSafeContainmentDiagnosticTraversesTypedCauseAndRedactsDetails(t *testing.T) {
	unsafe := "/private/path nonce=secret input=customer.docx"
	err := closedWith(ErrContainmentUnavailable, containment("start-transient-unit", dbus.Error{
		Name: "org.freedesktop.DBus.Error.InvalidArgs",
		Body: []any{unsafe},
	}))

	var supervisorError *SupervisorError
	if !errors.As(err, &supervisorError) {
		t.Fatal("typed supervisor error was not preserved")
	}
	var containmentError *ContainmentError
	if !errors.As(err, &containmentError) {
		t.Fatal("typed containment cause was not preserved")
	}

	got := safeContainmentDiagnostic(err)
	const want = "containment-unavailable stage=start-transient-unit reason=dbus-invalid-args"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
	if strings.Contains(got, unsafe) || strings.Contains(got, "private") || strings.Contains(got, "secret") || strings.Contains(got, "customer") {
		t.Fatalf("diagnostic leaked unsafe details: %q", got)
	}

	for _, unsafeError := range []error{
		closedWith(ErrContainmentUnavailable, &ContainmentError{Stage: unsafe, ReasonCode: "dbus-other"}),
		closedWith(ErrContainmentUnavailable, &ContainmentError{Stage: "preflight", ReasonCode: unsafe}),
		closedWith(ErrContainmentUnavailable, errors.New(unsafe)),
		errors.New(unsafe),
	} {
		if got := safeContainmentDiagnostic(unsafeError); got != "containment-unavailable" {
			t.Fatalf("unsafe diagnostic was not redacted: %q", got)
		}
	}
}

func TestSafeRunnerDiagnosticReportsOnlyBoundedTerminalCategories(t *testing.T) {
	unsafe := "/private/path nonce=secret input=customer.docx"
	got := safeRunnerDiagnostic(errors.New(unsafe), TerminalReport{
		PreStop: SandboxReport{
			ServiceResult: unsafe,
			MemoryEvents:  map[string]int64{"oom_kill": 1},
			PIDsEvents:    map[string]int64{"max": 1},
		},
	})
	const want = "error=unknown outcome=unknown service=unknown stage=success oom-killed=true pids-limited=true"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
	if strings.Contains(got, unsafe) || strings.Contains(got, "private") || strings.Contains(got, "secret") || strings.Contains(got, "customer") {
		t.Fatalf("diagnostic leaked unsafe details: %q", got)
	}
	for status, want := range map[int]string{70: "authorization", 71: "request-validation", 72: "source-validation", 73: "native-load", 74: "conversion-projection", 75: "result-write", 76: "acknowledgement", 77: "unknown"} {
		if got := safeRunnerStage(status); got != want {
			t.Fatalf("stage %d = %q, want %q", status, got, want)
		}
	}
}

type hostileEvidence struct {
	Name              string           `json:"name"`
	Outcome           ErrorCode        `json:"outcome"`
	Observed          map[string]bool  `json:"observed,omitempty"`
	MemoryEvents      map[string]int64 `json:"memoryEvents,omitempty"`
	CPUUsec           int64            `json:"cpuUsec"`
	CPUThrottled      int64            `json:"cpuThrottledUsec"`
	CPUPeriods        int64            `json:"cpuThrottledPeriods"`
	PIDsMax           int64            `json:"pidsMaxEvents"`
	ServiceResult     string           `json:"serviceResult,omitempty"`
	WallMillis        int64            `json:"wallMillis"`
	Cleaned           bool             `json:"cleaned"`
	TerminationEmpty  bool             `json:"terminationEmpty"`
	TerminationAbsent bool             `json:"terminationAbsent"`
}

type probeObservation struct {
	Schema  string          `json:"schema"`
	Version int             `json:"version"`
	Case    string          `json:"case"`
	Checks  map[string]bool `json:"checks"`
	PID     int             `json:"pid,omitempty"`
}

const (
	probeObservationSchema   = "crux-anydoc.hostile-probe-observation"
	probeObservationVersion  = 1
	probeObservationFrame    = "crux-anydoc-probe-observation/v1\n"
	maxProbeObservationBytes = 4 << 10
)

func writeProbeObservation(path, probeCase string, checks map[string]bool, pid int) error {
	payload, err := json.Marshal(probeObservation{Schema: probeObservationSchema, Version: probeObservationVersion, Case: probeCase, Checks: checks, PID: pid})
	if err != nil || len(payload)+len(probeObservationFrame) > maxProbeObservationBytes {
		return errors.New("encode observation")
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".observation-")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := io.WriteString(temporary, probeObservationFrame); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, path)
}

func decodeProbeObservation(input []byte, wantCase string) (probeObservation, string) {
	if len(input) > maxProbeObservationBytes {
		return probeObservation{}, "bounds"
	}
	if len(input) == 0 || !bytes.HasPrefix(input, []byte(probeObservationFrame)) {
		return probeObservation{}, "frame"
	}
	decoder := json.NewDecoder(bytes.NewReader(input[len(probeObservationFrame):]))
	decoder.DisallowUnknownFields()
	var value probeObservation
	if err := decoder.Decode(&value); err != nil {
		if strings.HasPrefix(err.Error(), "json: unknown field ") {
			return probeObservation{}, "fields"
		}
		return probeObservation{}, "json"
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return probeObservation{}, "json"
	}
	if value.Schema != probeObservationSchema {
		return probeObservation{}, "schema"
	}
	if value.Version != probeObservationVersion {
		return probeObservation{}, "version"
	}
	if value.Case != wantCase {
		return probeObservation{}, "case"
	}
	wantChecks, known := probeObservationChecks(wantCase)
	if !known || value.Checks == nil || len(value.Checks) != len(wantChecks) {
		return probeObservation{}, "fields"
	}
	for key := range wantChecks {
		if _, ok := value.Checks[key]; !ok {
			return probeObservation{}, "fields"
		}
	}
	if value.PID < 0 || value.PID > 1<<22 || (wantCase == "descendants") != (value.PID > 0) {
		return probeObservation{}, "bounds"
	}
	return value, ""
}

func probeObservationChecks(probeCase string) (map[string]struct{}, bool) {
	switch probeCase {
	case "network":
		return map[string]struct{}{"ipv4Denied": {}, "ipv6Denied": {}, "dnsDenied": {}}, true
	case "filesystem":
		return map[string]struct{}{"homeReadDenied": {}, "projectReadDenied": {}, "hostReadDenied": {}, "hostWriteDenied": {}, "hostTempInvisible": {}, "privateTempWritable": {}}, true
	case "privileges":
		return map[string]struct{}{"noNewPrivileges": {}, "capabilitiesEmpty": {}, "setuidDenied": {}}, true
	case "pids":
		return map[string]struct{}{"tasksLimitEnforced": {}}, true
	case "descendants":
		return map[string]struct{}{}, true
	}
	return nil, false
}

func TestProbeObservationCodecRejectsHostileInput(t *testing.T) {
	valid := func(probeCase string, pid int) []byte {
		keys, ok := probeObservationChecks(probeCase)
		if !ok {
			t.Fatal("missing test schema")
		}
		checks := make(map[string]bool, len(keys))
		for key := range keys {
			checks[key] = true
		}
		payload, err := json.Marshal(probeObservation{Schema: probeObservationSchema, Version: probeObservationVersion, Case: probeCase, Checks: checks, PID: pid})
		if err != nil {
			t.Fatal(err)
		}
		return append([]byte(probeObservationFrame), payload...)
	}

	for _, probeCase := range []string{"network", "filesystem", "privileges", "pids", "descendants"} {
		pid := 0
		if probeCase == "descendants" {
			pid = 42
		}
		if _, reason := decodeProbeObservation(valid(probeCase, pid), probeCase); reason != "" {
			t.Fatalf("%s valid observation rejected: %s", probeCase, reason)
		}
	}

	for _, test := range []struct {
		name, wantCase, wantReason string
		input                      []byte
	}{
		{"partial", "network", "frame", []byte(probeObservationFrame[:8])},
		{"malformed", "network", "json", append([]byte(probeObservationFrame), []byte("{")...)},
		{"unknown", "network", "fields", append([]byte(probeObservationFrame), []byte(`{"schema":"crux-anydoc.hostile-probe-observation","version":1,"case":"network","checks":{"ipv4Denied":true,"ipv6Denied":true,"dnsDenied":true},"extra":true}`)...)},
		{"schema", "network", "schema", bytes.Replace(valid("network", 0), []byte(probeObservationSchema), []byte("other"), 1)},
		{"version", "network", "version", bytes.Replace(valid("network", 0), []byte(`"version":1`), []byte(`"version":2`), 1)},
		{"case", "network", "case", valid("pids", 0)},
		{"fields", "network", "fields", append([]byte(probeObservationFrame), []byte(`{"schema":"crux-anydoc.hostile-probe-observation","version":1,"case":"network","checks":{}}`)...)},
		{"bounds", "descendants", "bounds", valid("descendants", 1<<22+1)},
		{"oversized", "network", "bounds", make([]byte, maxProbeObservationBytes+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, reason := decodeProbeObservation(test.input, test.wantCase); reason != test.wantReason {
				t.Fatalf("reason = %q, want %q", reason, test.wantReason)
			}
		})
	}

	dir := t.TempDir()
	path := filepath.Join(dir, "observation.json")
	if err := writeProbeObservation(path, "network", map[string]bool{"ipv4Denied": true, "ipv6Denied": true, "dnsDenied": true}, 0); err != nil {
		t.Fatal(err)
	}
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, reason := decodeProbeObservation(encoded, "network"); reason != "" {
		t.Fatalf("encoded observation rejected: %s", reason)
	}
}

func TestRunContainmentProbeUsesSealedRunLifecycle(t *testing.T) {
	source, err := os.ReadFile("systemd_integration_linux_test.go")
	if err != nil {
		t.Fatal(err)
	}
	start := bytes.Index(source, []byte("\nfunc runContainmentProbe("))
	end := bytes.Index(source[start:], []byte("\nfunc expectedProbeOutcome("))
	if start < 0 || end < 0 {
		t.Fatal("runContainmentProbe source boundary missing")
	}
	body := source[start+1 : start+end]
	for _, call := range [][]byte{[]byte("supervisor.startEvaluation("), []byte("run.receiveSealedProbeObservation("), []byte("run.Finish(")} {
		if !bytes.Contains(body, call) {
			t.Fatalf("runContainmentProbe bypasses sealed Run lifecycle: missing %q", call)
		}
	}
	if bytes.Contains(body, []byte("stopAwaitReadAndCleanupProbeObservation")) {
		t.Fatal("runContainmentProbe retained the legacy probe cleanup path")
	}
}

func runHostileContainmentCases(t *testing.T, launch LaunchDependency, root string) []hostileEvidence {
	t.Helper()
	cases := []struct {
		name    string
		action  string
		limits  Limits
		control string
	}{
		{"network", "network", Limits{64 << 20, 8, 25, 3 * time.Second}, "result"},
		{"filesystem", "filesystem", Limits{64 << 20, 8, 25, 3 * time.Second}, "result"},
		{"privileges", "privileges", Limits{64 << 20, 8, 25, 3 * time.Second}, "result"},
		// Eight is the smallest deterministic ceiling observed to admit the Go
		// probe and authorization handshake; it remains below admission's 16.
		{"pids", "pids", Limits{64 << 20, 8, 25, 3 * time.Second}, "result"},
		{"memory", "memory", Limits{64 << 20, 8, 25, 4 * time.Second}, "inactive"},
		{"cpu", "cpu", Limits{64 << 20, 8, 25, 4 * time.Second}, "cpu"},
		{"wall", "wall", Limits{64 << 20, 8, 25, 500 * time.Millisecond}, "inactive"},
		{"crash", "crash", Limits{64 << 20, 8, 25, 3 * time.Second}, "inactive"},
		{"abort", "wall", Limits{64 << 20, 8, 25, 4 * time.Second}, "abort"},
		{"descendants", "descendant", Limits{64 << 20, 8, 25, 4 * time.Second}, "descendant"},
	}
	results := make([]hostileEvidence, 0, len(cases))
	for _, tc := range cases {
		t.Run("hostile/"+tc.name, func(t *testing.T) {
			results = append(results, runContainmentProbe(t, launch, root, tc.name, tc.action, tc.control, tc.limits))
		})
	}
	return results
}

func runContainmentProbe(t *testing.T, launch LaunchDependency, root, name, action, control string, limits Limits) hostileEvidence {
	t.Helper()
	caseRoot := filepath.Join(root, "hostile-"+name)
	stagingRoot := filepath.Join(caseRoot, "input")
	privateTemp := filepath.Join(caseRoot, "private")
	for _, path := range []string{caseRoot, stagingRoot, privateTemp} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	hostTemp, workerTemp := "", ""
	if name == "filesystem" {
		token := strconv.Itoa(os.Getpid()) + "-" + filepath.Base(caseRoot)
		hostTemp = filepath.Join(os.TempDir(), "crux-anydoc-host-"+token)
		workerTemp = filepath.Join(os.TempDir(), "crux-anydoc-worker-"+token)
		if err := os.WriteFile(hostTemp, []byte("host-sentinel"), 0o600); err != nil {
			t.Fatal(err)
		}
		defer os.Remove(hostTemp)
		action = "filesystem:" + token
	}
	probePath, probeSHA := stageProbeExecutable(t, caseRoot)
	hostObservationPath := filepath.Join(privateTemp, "observation.json")
	probe := &containmentProbe{hostExecutable: probePath, executableSHA: probeSHA, action: action, caseID: name, resultPath: probeObservationTarget, hostResultPath: hostObservationPath}
	if control == "abort" {
		return runCanceledSupervisorProbe(t, launch, probe, stagingRoot, privateTemp, name, limits)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	supervisor := NewWithStager(&sealedProbeBackend{delegate: NewSystemdBackend(), probe: probe}, NewStager(stagingRoot))
	run, err := supervisor.startEvaluation(ctx, []byte("probe"), FormatDOCX, launch, privateTemp, limits)
	if err != nil {
		t.Fatalf("start %s probe: %v", name, err)
	}
	started := time.Now()
	if err := run.Authorize(); err != nil {
		_ = run.Finish(context.Background(), err)
		t.Fatalf("%s probe authorization failed: %v", name, err)
	}

	var observation probeObservation
	var finishInput error
	switch control {
	case "result", "descendant":
		if err := run.receiveSealedProbeObservation(ctx, probe); err != nil {
			_ = run.Finish(context.Background(), err)
			t.Fatalf("%s probe witness failed: %v", name, err)
		}
		bytes, err := os.ReadFile(probe.hostResultPath)
		if err != nil {
			_ = run.Finish(context.Background(), err)
			t.Fatalf("%s probe observation artifact unavailable: %v", name, err)
		}
		var reason string
		observation, reason = decodeProbeObservation(bytes, name)
		if reason != "" {
			_ = run.Finish(context.Background(), closed(ErrInvalidResult))
			t.Fatalf("%s probe observation artifact rejected: %s", name, reason)
		}
		if control == "descendant" {
			finishInput = context.Canceled
		}
	case "cpu":
		for {
			usage, usageErr := run.unit.CPUUsage(ctx)
			if usageErr != nil {
				t.Fatal(usageErr)
			}
			if usage >= 300*time.Millisecond {
				break
			}
			select {
			case <-ctx.Done():
				t.Fatal("CPU probe did not reach its cumulative test ceiling")
			case <-time.After(20 * time.Millisecond):
			}
		}
		finishInput = errCPUCeiling
	case "inactive":
		awaitUnitInactive(t, ctx, run.unit)
	case "abort":
		// Cancellation is represented by the caller terminating the isolated job.
	}
	finishErr := run.Finish(context.Background(), finishInput)
	wall := time.Since(started)
	terminal := run.TerminalReport()
	if finishErr != nil && errorCode(finishErr) == ErrContainmentUnavailable {
		t.Fatalf("%s probe cleanup failed: %v", name, finishErr)
	}
	if control == "result" || control == "descendant" {
		if name == "filesystem" {
			_, hostErr := os.Stat(workerTemp)
			observation.Checks["workerTempInvisibleOutside"] = os.IsNotExist(hostErr)
			if bytes, err := os.ReadFile(hostTemp); err != nil || string(bytes) != "host-sentinel" {
				observation.Checks["hostTempUnchanged"] = false
			} else {
				observation.Checks["hostTempUnchanged"] = true
			}
		}
	}
	outcome := terminal.Outcome
	if outcome != expectedProbeOutcome(name) {
		t.Fatalf("%s observed unexpected outcome %q", name, outcome)
	}
	terminal.Wall = wall
	if !terminal.Cleaned || (!terminal.Termination.Empty && !terminal.Termination.Absent) {
		t.Fatalf("%s lacked verified termination evidence", name)
	}
	if terminal.PreStop.MemoryMax > 128<<20 || terminal.PreStop.MemorySwapMax != 0 || terminal.PreStop.TasksMax != limits.TasksMax {
		t.Fatalf("%s effective limits drifted: %#v", name, terminal.PreStop)
	}
	if control == "result" {
		for check, ok := range observation.Checks {
			if !ok {
				t.Fatalf("%s containment check failed: %s", name, check)
			}
		}
	}
	if terminal.Outcome == ErrContainmentUnavailable {
		t.Fatalf("%s did not produce its expected observed closed outcome: %#v", name, terminal)
	}
	if expected, ok := map[string]WorkloadOutcomeCode{
		"memory": WorkloadOutcomeOOM,
		"cpu":    WorkloadOutcomeCPUTimeout,
		"wall":   WorkloadOutcomeWallTimeout,
		"crash":  WorkloadOutcomeCrash,
	}[name]; ok && terminal.Workload.Code != expected {
		t.Fatalf("%s did not retain its Task2 workload outcome: got %q, want %q", name, terminal.Workload.Code, expected)
	}
	if name == "memory" && terminal.PreStop.MemoryEvents["oom_kill"] < 1 && terminal.PreStop.ServiceResult != "oom-kill" {
		t.Fatalf("memory probe lacked observed OOM evidence: events=%#v result=%q", terminal.PreStop.MemoryEvents, terminal.PreStop.ServiceResult)
	}
	if name == "cpu" && (terminal.CPU < 300*time.Millisecond || terminal.CPU > 900*time.Millisecond) {
		t.Fatalf("CPU probe exceeded bounded cumulative ceiling: %s", terminal.CPU)
	}
	if name == "cpu" {
		if terminal.PreStop.CPUStats["nr_throttled"] < 1 || terminal.PreStop.CPUStats["throttled_usec"] < 1 {
			t.Fatalf("CPU quota did not produce throttling evidence: %#v", terminal.PreStop.CPUStats)
		}
		if terminal.CPU*100 > terminal.Wall*time.Duration(limits.CPUQuotaPercent+15) {
			t.Fatalf("CPU/wall ratio exceeded quota tolerance: cpu=%s wall=%s quota=%d", terminal.CPU, terminal.Wall, limits.CPUQuotaPercent)
		}
	}
	if name == "pids" && terminal.PreStop.PIDsEvents["max"] < 1 {
		t.Fatalf("TasksMax did not increment pids.events: %#v", terminal.PreStop.PIDsEvents)
	}
	if name == "wall" && terminal.Wall > 2*time.Second {
		t.Fatalf("wall timeout was not prompt: %s", terminal.Wall)
	}
	if name == "descendants" && observation.PID > 0 {
		deadline := time.Now().Add(time.Second)
		for processExists(observation.PID) && time.Now().Before(deadline) {
			time.Sleep(20 * time.Millisecond)
		}
		if processExists(observation.PID) {
			t.Fatalf("descendant %d escaped cgroup cleanup", observation.PID)
		}
	}
	return hostileEvidence{Name: name, Outcome: terminal.Outcome, Observed: observation.Checks, MemoryEvents: terminal.PreStop.MemoryEvents, CPUUsec: terminal.CPU.Microseconds(), CPUThrottled: terminal.PreStop.CPUStats["throttled_usec"], CPUPeriods: terminal.PreStop.CPUStats["nr_throttled"], PIDsMax: terminal.PreStop.PIDsEvents["max"], ServiceResult: terminal.PreStop.ServiceResult, WallMillis: terminal.Wall.Milliseconds(), Cleaned: terminal.Cleaned, TerminationEmpty: terminal.Termination.Empty, TerminationAbsent: terminal.Termination.Absent}
}

func expectedProbeOutcome(name string) ErrorCode {
	switch name {
	case "network", "filesystem", "privileges", "pids":
		return OutcomeSuccess
	case "memory", "crash":
		return ErrWorkerCrash
	case "cpu", "wall":
		return ErrTimeout
	case "abort", "descendants":
		return ErrAborted
	}
	return ErrContainmentUnavailable
}

type sealedProbeBackend struct {
	delegate Backend
	probe    *containmentProbe
}

func (b *sealedProbeBackend) Start(ctx context.Context, spec ServiceSpec, stdin *os.File) (Unit, error) {
	if b == nil || b.delegate == nil || b.probe == nil {
		return nil, closed(ErrContainmentUnavailable)
	}
	spec.BindReadOnlyPaths = append(spec.BindReadOnlyPaths, b.probe.hostExecutable+":"+probeTarget)
	spec.probe = b.probe
	return b.delegate.Start(ctx, spec, stdin)
}

func runCanceledSupervisorProbe(t *testing.T, launch LaunchDependency, probe *containmentProbe, stagingRoot, privateTemp, name string, limits Limits) hostileEvidence {
	t.Helper()
	backend := &sealedProbeBackend{delegate: NewSystemdBackend(), probe: probe}
	supervisor := NewWithStager(backend, NewStager(stagingRoot))
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	run, err := supervisor.startEvaluation(ctx, []byte("probe"), FormatDOCX, launch, privateTemp, limits)
	if err != nil {
		t.Fatalf("start canceled probe: %v", err)
	}
	if err := run.Authorize(); err != nil {
		_ = run.Finish(context.Background(), err)
		t.Fatalf("authorize canceled probe: %v", err)
	}
	canceled, cancelNow := context.WithCancel(ctx)
	cancelNow()
	_, err = run.Execute(canceled)
	if errorCode(err) != ErrAborted {
		t.Fatalf("caller cancellation was not mapped to abort: %v", err)
	}
	terminal := run.TerminalReport()
	if terminal.Outcome != ErrAborted || !terminal.Cleaned || (!terminal.Termination.Empty && !terminal.Termination.Absent) {
		t.Fatalf("caller cancellation lacked closed terminal evidence: %#v", terminal)
	}
	return hostileEvidence{Name: name, Outcome: terminal.Outcome, MemoryEvents: terminal.PreStop.MemoryEvents, CPUUsec: terminal.CPU.Microseconds(), CPUThrottled: terminal.PreStop.CPUStats["throttled_usec"], CPUPeriods: terminal.PreStop.CPUStats["nr_throttled"], PIDsMax: terminal.PreStop.PIDsEvents["max"], WallMillis: terminal.Wall.Milliseconds(), Cleaned: terminal.Cleaned, TerminationEmpty: terminal.Termination.Empty, TerminationAbsent: terminal.Termination.Absent}
}

func stageProbeExecutable(t *testing.T, root string) (string, string) {
	t.Helper()
	// /proc/self/exe is the already-running, kernel-held integration binary;
	// callers cannot substitute an arbitrary executable path.
	input, err := os.Open("/proc/self/exe")
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	path := filepath.Join(root, "probe")
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0o555)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(output, hash), io.LimitReader(input, (128<<20)+1)); err != nil {
		_ = output.Close()
		t.Fatal(err)
	}
	if err := output.Sync(); err != nil {
		_ = output.Close()
		t.Fatal(err)
	}
	if err := output.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o555 || info.Size() <= 0 || info.Size() > 128<<20 {
		t.Fatal("unsafe staged probe executable")
	}
	return path, hex.EncodeToString(hash.Sum(nil))
}

func observedProbeOutcome(name string, observation probeObservation, report SandboxReport, cpu time.Duration, wall time.Duration) ErrorCode {
	switch name {
	case "network", "filesystem", "privileges", "pids":
		if len(observation.Checks) == 0 {
			return ErrContainmentUnavailable
		}
		for _, ok := range observation.Checks {
			if !ok {
				return ErrContainmentUnavailable
			}
		}
		return OutcomeSuccess
	case "memory":
		if report.MemoryEvents["oom_kill"] > 0 || report.ServiceResult == "oom-kill" {
			return ErrWorkerCrash
		}
	case "cpu":
		if cpu >= 300*time.Millisecond && cpu <= 900*time.Millisecond {
			return ErrTimeout
		}
	case "wall":
		if wall >= report.RuntimeMax && report.ServiceResult != "success" {
			return ErrTimeout
		}
	case "crash":
		if report.ExecMainStatus == 19 && report.ServiceResult != "success" {
			return ErrWorkerCrash
		}
	case "abort", "descendants":
		if report.ServiceResult != "success" {
			return ErrAborted
		}
	}
	return ErrContainmentUnavailable
}

func awaitUnitInactive(t *testing.T, ctx context.Context, unit Unit) {
	t.Helper()
	for {
		status, err := unit.TerminalStatus(ctx)
		if err == nil && status.MainPID == 0 && (status.State == "inactive" || status.State == "failed") {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("probe unit remained active")
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func processExists(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func TestContainmentProbeProcess(t *testing.T) {
	separator := -1
	for i, arg := range os.Args {
		if arg == "--" {
			separator = i
			break
		}
	}
	if separator < 0 || len(os.Args) != separator+5 {
		return
	}
	action, resultPath, capabilityPath := os.Args[separator+1], os.Args[separator+2], os.Args[separator+3]
	conn, err := net.DialTimeout("unix", capabilityPath, time.Second)
	if err != nil {
		os.Exit(22)
	}
	request, err := DecodeRequest(conn)
	if err != nil {
		_ = conn.Close()
		os.Exit(23)
	}
	_ = conn.Close()
	checks := map[string]bool{}
	write := func(pid int) {
		if err := writeProbeObservation(resultPath, probeCaseForAction(action), checks, pid); err != nil {
			os.Exit(24)
		}
		ack, err := net.DialTimeout("unix", os.Args[separator+4], time.Second)
		if err != nil {
			os.Exit(25)
		}
		observation := sealedProbeObservation{Schema: sealedProbeObservationSchema, Version: sealedProbeObservationVersion, Case: probeCaseForAction(action), Invocation: request.RequestDigest, Checks: checks}
		if err := writeFrame(ack, observation); err != nil {
			_ = ack.Close()
			os.Exit(25)
		}
		confirmation := make([]byte, 4)
		if _, err := io.ReadFull(ack, confirmation); err != nil || string(confirmation) != "ACK\n" {
			_ = ack.Close()
			os.Exit(25)
		}
		_ = ack.Close()
	}
	if strings.HasPrefix(action, "filesystem:") {
		token := strings.TrimPrefix(action, "filesystem:")
		for name, path := range map[string]string{"home": "/root/.ssh", "project": "/home", "host": "/var/lib"} {
			_, err := os.ReadDir(path)
			checks[name+"ReadDenied"] = err != nil
		}
		checks["hostWriteDenied"] = os.WriteFile("/etc/crux-probe", []byte("x"), 0o600) != nil
		hostSentinel := filepath.Join(os.TempDir(), "crux-anydoc-host-"+token)
		_, sentinelErr := os.ReadFile(hostSentinel)
		checks["hostTempInvisible"] = os.IsNotExist(sentinelErr)
		tmp := filepath.Join(os.TempDir(), "crux-anydoc-worker-"+token)
		checks["privateTempWritable"] = os.WriteFile(tmp, []byte("ok"), 0o600) == nil
		write(0)
		time.Sleep(300 * time.Millisecond)
		return
	}
	switch action {
	case "network":
		for name, address := range map[string]string{"ipv4": "1.1.1.1:53", "ipv6": "[2606:4700:4700::1111]:53"} {
			conn, err := net.DialTimeout("tcp", address, 200*time.Millisecond)
			if conn != nil {
				_ = conn.Close()
			}
			checks[name+"Denied"] = err != nil
		}
		_, err := net.LookupHost("example.com")
		checks["dnsDenied"] = err != nil
		write(0)
	case "privileges":
		status, _ := os.ReadFile("/proc/self/status")
		checks["noNewPrivileges"] = strings.Contains(string(status), "NoNewPrivs:\t1")
		checks["capabilitiesEmpty"] = strings.Contains(string(status), "CapEff:\t0000000000000000")
		checks["setuidDenied"] = syscall.Setuid(0) != nil
		write(0)
	case "pids":
		children := []*exec.Cmd{}
		for i := 0; i < 8; i++ {
			cmd := exec.Command(os.Args[0], "-test.run=^TestContainmentProbeChild$", "--", "child")
			if err := cmd.Start(); err != nil {
				checks["tasksLimitEnforced"] = true
				break
			}
			children = append(children, cmd)
		}
		write(0)
		for _, child := range children {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	case "memory":
		blocks := make([][]byte, 0, 64)
		for {
			block := make([]byte, 4<<20)
			for i := range block {
				block[i] = 1
			}
			blocks = append(blocks, block)
		}
	case "cpu":
		for {
			_ = sha256.Sum256([]byte(strconv.FormatInt(time.Now().UnixNano(), 10)))
		}
	case "wall":
		time.Sleep(time.Minute)
	case "crash":
		os.Exit(19)
	case "descendant":
		cmd := exec.Command("/bin/sh", "-c", "sleep 60")
		if cmd.Start() != nil {
			os.Exit(20)
		}
		write(cmd.Process.Pid)
		time.Sleep(time.Minute)
	default:
		os.Exit(21)
	}
	time.Sleep(300 * time.Millisecond)
}

func probeCaseForAction(action string) string {
	if strings.HasPrefix(action, "filesystem:") {
		return "filesystem"
	}
	if action == "descendant" {
		return "descendants"
	}
	return action
}

func TestContainmentProbeChild(t *testing.T) {
	if len(os.Args) > 1 && os.Args[len(os.Args)-1] == "child" {
		time.Sleep(time.Minute)
	}
}

func assertIntegrationCleanup(t *testing.T, root, stagingRoot, privateTemp string, run *Run) {
	t.Helper()
	if run == nil || run.unit == nil {
		t.Fatal("missing completed unit")
	}
	report := run.TerminalReport()
	if !report.Cleaned {
		t.Fatal("transient unit did not become inactive and clean up")
	}
	entries, err := os.ReadDir(stagingRoot)
	if err != nil {
		t.Fatalf("inspect staged-input cleanup: %v", err)
	}
	if len(entries) != 0 {
		t.Fatal("cleanup retained staged input")
	}
	if _, err := os.Stat(privateTemp); !os.IsNotExist(err) {
		t.Fatalf("cleanup retained private temporary directory: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("integration root unexpectedly disappeared: %v", err)
	}
}

func writeContainmentEvidence(t *testing.T, result Result, terminal TerminalReport, hostile []hostileEvidence) {
	t.Helper()
	path := os.Getenv("CRUX_SYSTEMD_EVIDENCE_PATH")
	if path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	// Deliberately omit source paths and payload: the artifact is containment
	// evidence, not a document-exfiltration channel.
	evidence := struct {
		Format               string            `json:"format"`
		SourceSHA256         string            `json:"sourceSha256"`
		SourceBytes          int64             `json:"sourceBytes"`
		ResultBytes          int               `json:"resultBytes"`
		Outcome              ErrorCode         `json:"outcome"`
		Cleaned              bool              `json:"cleaned"`
		PreStopMemoryMax     int64             `json:"preStopMemoryMax"`
		PreStopMemoryCurrent int64             `json:"preStopMemoryCurrent"`
		PreStopMemoryPeak    int64             `json:"preStopMemoryPeak"`
		PreStopMemoryEvents  map[string]int64  `json:"preStopMemoryEvents"`
		TasksMax             int               `json:"tasksMax"`
		CPUUsec              int64             `json:"cpuUsec"`
		WallMillis           int64             `json:"wallMillis"`
		Hostile              []hostileEvidence `json:"hostile"`
		TerminationEmpty     bool              `json:"terminationEmpty"`
		TerminationAbsent    bool              `json:"terminationAbsent"`
	}{string(result.Format), result.SourceSHA256, result.SourceBytes, len(result.Payload), terminal.Outcome, terminal.Cleaned, terminal.PreStop.MemoryMax, terminal.PreStop.MemoryCurrent, terminal.PreStop.MemoryPeak, terminal.PreStop.MemoryEvents, terminal.PreStop.TasksMax, terminal.CPU.Microseconds(), terminal.Wall.Milliseconds(), hostile, terminal.Termination.Empty, terminal.Termination.Absent}
	if evidence.PreStopMemoryMax > MemoryCeiling/2 {
		t.Fatal("integration memory ceiling exceeds half the production ceiling")
	}
	bytes, err := json.Marshal(evidence)
	if err != nil {
		t.Fatal(err)
	}
	if len(bytes) > 8192 {
		t.Fatal("containment evidence exceeded bound")
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestSafeExecutionFailurePrefersResultValidationOverContainmentInErrorChain(t *testing.T) {
	// Genuine pre-existing ResultValidationError outranks outer ContainmentError.
	// Pure cleanup uses ContainmentError only (see chainContainment(nil, ...)).
	err := errors.Join(
		&ContainmentError{Stage: "containment-cleanup", ReasonCode: "accounting-evidence"},
		closedWith(ErrContainmentUnavailable, closedWith(ErrInvalidResult, resultValidation("payload/validation", "invalid-result"))),
	)
	terminal := TerminalReport{
		Outcome: ErrInvalidResult,
		PreStop: SandboxReport{ExecMainStatus: 76, ServiceResult: "exit-code"},
	}
	got := safeExecutionFailure(err, terminal)
	const want = "error=invalid-result outcome=invalid-result service=exit-code stage=payload/validation reason=invalid-result oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
}

func TestExecutePreservesRefreshValidationThroughAccountingCleanup(t *testing.T) {
	staged, err := NewStager(t.TempDir()).Stage([]byte("test"), 1024)
	if err != nil {
		t.Fatal(err)
	}

	_, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}

	limits := testJobLimits()
	sourceSHA := sha256Hex([]byte("test"))
	path := t.TempDir() + "/result.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	fs := newFakeFS()
	request := Request{Version: ProtocolVersion, Nonce: "00000000000000000000000000000000", Format: FormatDOCX, SourceSHA256: sourceSHA, SourceBytes: 4, Limits: limits}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
	unit := &systemdUnit{
		name:           "crux-anydoc-refresh-failure.service",
		bus:            newFakeSystemBus(),
		fs:             fs,
		now:            immediateClock{},
		resultListener: listener,
		resultSocket:   path,
		peers:          fakePeer{pid: 42},
	}
	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	fs.failReadAt[cgroupFile("/crux.slice/test", "memory.peak")] = 3
	r := &Run{
		unit:        unit,
		write:       write,
		nonce:       "00000000000000000000000000000000",
		digest:      requestDigest(ProtocolVersion, "00000000000000000000000000000000", "docx", sourceSHA, 4, limits),
		sourceSHA:   sourceSHA,
		sourceBytes: 4,
		format:      FormatDOCX,
		limits:      limits,
		staged:      staged,
		stop:        make(chan struct{}),
		finished:    make(chan struct{}),
		started:     time.Now(),
	}
	go func() {
		conn, dialErr := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
		if dialErr == nil {
			_ = EncodeResult(conn, validWireResult(request))
			_ = conn.Close()
		}
	}()

	_, err = r.Execute(context.Background())
	var validation *ResultValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("Execute lost ResultValidationError through cleanup: %T %v", err, err)
	}
	if validation.Stage != "accounting-refresh" || validation.ReasonCode != "unavailable" {
		t.Fatalf("ResultValidationError = {stage:%q reason:%q}", validation.Stage, validation.ReasonCode)
	}
	if errorCode(err) != ErrContainmentUnavailable {
		t.Fatalf("outer error = %q, want %q", errorCode(err), ErrContainmentUnavailable)
	}

	got := safeExecutionFailure(err, r.TerminalReport())
	const want = "error=invalid-result outcome=containment-unavailable service=unknown stage=accounting-refresh reason=unavailable oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func makeWritableTree(t *testing.T, root string) {
	t.Helper()
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err == nil && info.IsDir() {
			_ = os.Chmod(path, 0o755)
		}
		return nil
	})
}
