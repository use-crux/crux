//go:build linux

package anydocsupervisor

import (
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
	run, err := supervisor.StartEvaluation(ctx, input, FormatDOCX, launch, privateTemp, Limits{
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
	Checks map[string]bool `json:"checks"`
	PID    int             `json:"pid,omitempty"`
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
	probe := &containmentProbe{hostExecutable: probePath, executableSHA: probeSHA, action: action, resultPath: filepath.Join(privateTemp, "observation.json")}
	if control == "abort" {
		return runCanceledSupervisorProbe(t, launch, probe, stagingRoot, privateTemp, name, limits)
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
	resultPath := probe.resultPath
	spec.BindReadOnlyPaths = append(spec.BindReadOnlyPaths, probePath+":"+probeTarget)
	spec.probe = probe
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
	if !verify(ctx, unit, spec) {
		_, _, _, _ = cleanup(unit)
		t.Fatalf("%s probe did not enter the centrally verified production sandbox", name)
	}
	preparer, prepareOK := unit.(authorizationPreparer)
	authorizer, authorizeOK := unit.(capabilityAuthorizer)
	if !prepareOK || !authorizeOK || preparer.PrepareAuthorization(ctx) != nil {
		_, _, _, _ = cleanup(unit)
		t.Fatalf("%s probe could not prepare its production authorization channel", name)
	}
	sourceSHA := sha256Hex([]byte("probe"))
	jobLimits := testJobLimits()
	nonce := "00000000000000000000000000000000"
	request := Request{Version: ProtocolVersion, Nonce: nonce, Format: "docx", SourceSHA256: sourceSHA, SourceBytes: 5, Limits: jobLimits}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
	if err := authorizer.AuthorizeCapability(ctx, request); err != nil {
		_, _, _, _ = cleanup(unit)
		t.Fatalf("%s probe authorization failed: %v", name, err)
	}

	var observation probeObservation
	switch control {
	case "result", "descendant":
		observation = awaitProbeObservation(t, ctx, resultPath)
		if name == "filesystem" {
			_, hostErr := os.Stat(workerTemp)
			observation.Checks["workerTempInvisibleOutside"] = os.IsNotExist(hostErr)
			if bytes, err := os.ReadFile(hostTemp); err != nil || string(bytes) != "host-sentinel" {
				observation.Checks["hostTempUnchanged"] = false
			} else {
				observation.Checks["hostTempUnchanged"] = true
			}
		}
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
	report, cpu, termination, cleaned := cleanup(unit)
	wall := time.Since(started)
	outcome := observedProbeOutcome(name, observation, report, cpu, wall)
	if outcome != expectedProbeOutcome(name) {
		t.Fatalf("%s observed unexpected outcome %q", name, outcome)
	}
	terminal := TerminalReport{PreStop: report, Termination: termination, CPU: cpu, Wall: wall, Outcome: outcome, Cleaned: cleaned}
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
	run, err := supervisor.StartEvaluation(ctx, []byte("probe"), FormatDOCX, launch, privateTemp, limits)
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
		Format               string            `json:"format"`
		SourceSHA256         string            `json:"sourceSha256"`
		SourceBytes          int64             `json:"sourceBytes"`
		ResultBytes          int               `json:"resultBytes"`
		Outcome              ErrorCode         `json:"outcome"`
		Cleaned              bool              `json:"cleaned"`
		PreStopMemoryMax     int64             `json:"preStopMemoryMax"`
		PreStopMemoryCurrent int64             `json:"preStopMemoryCurrent"`
		PreStopMemoryEvents  map[string]int64  `json:"preStopMemoryEvents"`
		TasksMax             int               `json:"tasksMax"`
		CPUUsec              int64             `json:"cpuUsec"`
		WallMillis           int64             `json:"wallMillis"`
		Hostile              []hostileEvidence `json:"hostile"`
		TerminationEmpty     bool              `json:"terminationEmpty"`
		TerminationAbsent    bool              `json:"terminationAbsent"`
	}{string(result.Format), result.SourceSHA256, result.SourceBytes, len(result.Payload), terminal.Outcome, terminal.Cleaned, terminal.PreStop.MemoryMax, terminal.PreStop.MemoryCurrent, terminal.PreStop.MemoryEvents, terminal.PreStop.TasksMax, terminal.CPU.Microseconds(), terminal.Wall.Milliseconds(), hostile, terminal.Termination.Empty, terminal.Termination.Absent}
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
