//go:build linux

package anydocsupervisor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
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

	input, err := os.ReadFile(filepath.Join("..", "..", "..", "ingest", "evals", "anydoc", "fixtures", "prose.docx"))
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
	run, err := supervisor.Start(ctx, input, launch, privateTemp, Limits{
		MemoryMax:       128 << 20,
		TasksMax:        8,
		CPUQuotaPercent: 50,
		RuntimeMax:      20 * time.Second,
	})
	if err != nil {
		t.Fatalf("start transient service: %v", err)
	}

	if err := run.Authorize(); err != nil {
		_ = run.Finish(context.Background(), err)
		t.Fatalf("authorize one-shot job: %v", err)
	}
	result, err := run.Execute(ctx)
	if err != nil {
		t.Fatalf("execute packaged runner: %v", err)
	}
	if !result.OK || result.Accounting == nil || result.Accounting.SourceBytes != int64(len(input)) || result.SourceSHA256 != sha256Hex(input) || result.Format != "docx" {
		t.Fatalf("unbound or invalid runner result: %#v", result)
	}
	assertIntegrationCleanup(t, root, stagingRoot, privateTemp, run)
	hostile := runHostileContainmentCases(t, launch, root)
	writeContainmentEvidence(t, result, run.TerminalReport(), hostile)
}

type hostileEvidence struct {
	Name         string           `json:"name"`
	Outcome      ErrorCode        `json:"outcome"`
	Observed     map[string]bool  `json:"observed,omitempty"`
	MemoryEvents map[string]int64 `json:"memoryEvents,omitempty"`
	CPUUsec      int64            `json:"cpuUsec"`
	WallMillis   int64            `json:"wallMillis"`
	Cleaned      bool             `json:"cleaned"`
	Populated    bool             `json:"populated"`
}

type probeObservation struct {
	Checks map[string]bool `json:"checks"`
	PID    int             `json:"pid,omitempty"`
}

func runHostileContainmentCases(t *testing.T, launch LaunchDependency, root string) []hostileEvidence {
	t.Helper()
	testBinary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		action  string
		limits  Limits
		control string
	}{
		{"network", "network", Limits{64 << 20, 8, 25, 3 * time.Second}, "result"},
		{"filesystem", "filesystem", Limits{64 << 20, 8, 25, 3 * time.Second}, "result"},
		{"privileges", "privileges", Limits{64 << 20, 8, 25, 3 * time.Second}, "result"},
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
			results = append(results, runContainmentProbe(t, launch, testBinary, root, tc.name, tc.action, tc.control, tc.limits))
		})
	}
	return results
}

func runContainmentProbe(t *testing.T, launch LaunchDependency, executable, root, name, action, control string, limits Limits) hostileEvidence {
	t.Helper()
	caseRoot := filepath.Join(root, "hostile-"+name)
	stagingRoot := filepath.Join(caseRoot, "input")
	privateTemp := filepath.Join(caseRoot, "private")
	for _, path := range []string{caseRoot, stagingRoot, privateTemp} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	staged, err := NewStager(stagingRoot).Stage([]byte("probe"), 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer staged.Cleanup()
	spec, err := serviceSpec(staged.HostPath, launch, privateTemp, limits)
	if err != nil {
		t.Fatal(err)
	}
	resultPath := filepath.Join(privateTemp, "observation.json")
	spec.probe = &containmentProbe{executable: executable, action: action, resultPath: resultPath}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer write.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	unit, err := NewSystemdBackend().Start(ctx, spec, read)
	if err != nil {
		t.Fatalf("start %s probe: %v", name, err)
	}
	started := time.Now()
	initial, err := unit.Report(ctx)
	if err != nil || initial.MainPID <= 0 || initial.RuntimeTreeDigest != spec.runtimeTreeDigest {
		_, _, _ = cleanup(unit)
		t.Fatalf("%s probe did not enter verified production sandbox: %#v %v", name, initial, err)
	}
	preparer, prepareOK := unit.(authorizationPreparer)
	authorizer, authorizeOK := unit.(capabilityAuthorizer)
	if !prepareOK || !authorizeOK || preparer.PrepareAuthorization(ctx) != nil {
		_, _, _ = cleanup(unit)
		t.Fatalf("%s probe could not prepare its production authorization channel", name)
	}
	sourceSHA := sha256Hex([]byte("probe"))
	jobLimits := JobLimits{SourceBytes: 1024, ResultBytes: 1024}
	nonce := "00000000000000000000000000000000"
	request := Request{Version: ProtocolVersion, Nonce: nonce, Format: "docx", SourceSHA256: sourceSHA, SourceBytes: 5, Limits: jobLimits}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
	if err := authorizer.AuthorizeCapability(ctx, request); err != nil {
		_, _, _ = cleanup(unit)
		t.Fatalf("%s probe authorization failed: %v", name, err)
	}

	var observation probeObservation
	switch control {
	case "result", "descendant":
		observation = awaitProbeObservation(t, ctx, resultPath)
	case "cpu":
		for {
			usage, usageErr := unit.CPUUsage(ctx)
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
	case "inactive":
		awaitUnitInactive(t, ctx, unit)
	case "abort":
		// Cancellation is represented by the caller terminating the isolated job.
	}
	report, cpu, cleaned := cleanup(unit)
	wall := time.Since(started)
	outcome := observedProbeOutcome(name, observation, report, cpu, wall)
	terminal := TerminalReport{Sandbox: report, CPU: cpu, Wall: wall, Outcome: outcome, Cleaned: cleaned}
	if !terminal.Cleaned || terminal.Sandbox.Populated {
		t.Fatalf("%s left a populated cgroup", name)
	}
	if terminal.Sandbox.MemoryMax > 128<<20 || terminal.Sandbox.MemorySwapMax != 0 || terminal.Sandbox.TasksMax != limits.TasksMax {
		t.Fatalf("%s effective limits drifted: %#v", name, terminal.Sandbox)
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
	if name == "memory" && terminal.Sandbox.MemoryEvents["oom_kill"] < 1 {
		t.Fatalf("memory probe lacked observed OOM kill: %#v", terminal.Sandbox.MemoryEvents)
	}
	if name == "cpu" && (terminal.CPU < 300*time.Millisecond || terminal.CPU > 900*time.Millisecond) {
		t.Fatalf("CPU probe exceeded bounded cumulative ceiling: %s", terminal.CPU)
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
	return hostileEvidence{Name: name, Outcome: terminal.Outcome, Observed: observation.Checks, MemoryEvents: terminal.Sandbox.MemoryEvents, CPUUsec: terminal.CPU.Microseconds(), WallMillis: terminal.Wall.Milliseconds(), Cleaned: terminal.Cleaned, Populated: terminal.Sandbox.Populated}
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
		return ""
	case "memory":
		if report.MemoryEvents["oom_kill"] > 0 {
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

func awaitProbeObservation(t *testing.T, ctx context.Context, path string) probeObservation {
	t.Helper()
	for {
		bytes, err := os.ReadFile(path)
		if err == nil {
			var value probeObservation
			if json.Unmarshal(bytes, &value) != nil {
				t.Fatal("invalid probe observation")
			}
			return value
		}
		select {
		case <-ctx.Done():
			t.Fatalf("probe observation unavailable: %v", err)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func awaitUnitInactive(t *testing.T, ctx context.Context, unit Unit) {
	t.Helper()
	for {
		report, err := unit.Report(ctx)
		if err == nil && report.MainPID == 0 {
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
	if _, err := DecodeRequest(conn); err != nil {
		_ = conn.Close()
		os.Exit(23)
	}
	_ = conn.Close()
	checks := map[string]bool{}
	write := func(pid int) {
		bytes, _ := json.Marshal(probeObservation{Checks: checks, PID: pid})
		_ = os.WriteFile(resultPath, bytes, 0o600)
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
	case "filesystem":
		for name, path := range map[string]string{"home": "/root/.ssh", "project": "/home", "host": "/var/lib"} {
			_, err := os.ReadDir(path)
			checks[name+"ReadDenied"] = err != nil
		}
		checks["hostWriteDenied"] = os.WriteFile("/etc/crux-probe", []byte("x"), 0o600) != nil
		tmp := filepath.Join(os.TempDir(), "crux-private-probe")
		checks["privateTempWritable"] = os.WriteFile(tmp, []byte("ok"), 0o600) == nil
		write(0)
	case "privileges":
		status, _ := os.ReadFile("/proc/self/status")
		checks["noNewPrivileges"] = strings.Contains(string(status), "NoNewPrivs:\t1")
		checks["capabilitiesEmpty"] = strings.Contains(string(status), "CapEff:\t0000000000000000")
		checks["setuidDenied"] = syscall.Setuid(0) != nil
		write(0)
	case "pids":
		children := []*exec.Cmd{}
		for i := 0; i < 32; i++ {
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
		Format        string            `json:"format"`
		SourceSHA256  string            `json:"sourceSha256"`
		SourceBytes   int64             `json:"sourceBytes"`
		ResultBytes   int               `json:"resultBytes"`
		Outcome       ErrorCode         `json:"outcome"`
		Cleaned       bool              `json:"cleaned"`
		MemoryMax     int64             `json:"memoryMax"`
		MemoryCurrent int64             `json:"memoryCurrent"`
		MemoryEvents  map[string]int64  `json:"memoryEvents"`
		TasksMax      int               `json:"tasksMax"`
		CPUUsec       int64             `json:"cpuUsec"`
		WallMillis    int64             `json:"wallMillis"`
		Hostile       []hostileEvidence `json:"hostile"`
	}{result.Format, result.SourceSHA256, result.SourceBytes, len(result.Payload), terminal.Outcome, terminal.Cleaned, terminal.Sandbox.MemoryMax, terminal.Sandbox.MemoryCurrent, terminal.Sandbox.MemoryEvents, terminal.Sandbox.TasksMax, terminal.CPU.Microseconds(), terminal.Wall.Milliseconds(), hostile}
	if evidence.MemoryMax > MemoryCeiling/2 {
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
