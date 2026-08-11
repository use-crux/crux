//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/use-crux/crux/packages/local/internal/assets"
)

func TestSystemdStartUsesExactContainmentPropertiesAndClosesLocalFD(t *testing.T) {
	bus := newFakeSystemBus()
	backend := NewSystemdBackendWith(SystemdBackendOptions{Bus: bus, FileSystem: newFakeFS(), Clock: immediateClock{}})
	root, err := os.MkdirTemp("/tmp", "a-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	input, runtime, tmp := root+"/input", root+"/runtime", root+"/private"
	for _, path := range []string{input, runtime, tmp} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer write.Close()
	spec, err := newTestServiceSpec(input, runtime, tmp, Limits{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = backend.Start(context.Background(), spec, read)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(backend.(*systemdBackend).fs.(*fakeFS).chmods[:2], []os.FileMode{0o666, 0}) {
		t.Fatalf("authorization/result socket startup modes = %#v, want connectable authorization barrier and closed result socket", backend.(*systemdBackend).fs.(*fakeFS).chmods)
	}
	if _, err := read.Stat(); err == nil {
		t.Fatal("backend retained local stdin FD")
	}
	if !strings.HasPrefix(bus.name, "crux-anydoc-") || !strings.HasSuffix(bus.name, ".service") || strings.ContainsAny(bus.name, "/ ") {
		t.Fatalf("unsafe transient unit name %q", bus.name)
	}
	got := propertiesByName(bus.properties)
	want := map[string]any{
		"CPUAccounting":           true,
		"CPUQuotaPerSecUSec":      uint64(600_000),
		"MemoryMax":               uint64(MemoryCeiling),
		"MemorySwapMax":           uint64(0),
		"TasksMax":                uint64(TasksCeiling),
		"RuntimeMaxUSec":          uint64(RuntimeCeiling / time.Microsecond),
		"KillMode":                "control-group",
		"NoNewPrivileges":         true,
		"CapabilityBoundingSet":   uint64(0),
		"PrivateNetwork":          true,
		"RestrictAddressFamilies": restrictAddressFamilies{Allow: true, Families: []string{"AF_UNIX"}},
		"PrivateTmp":              true,
		"ProtectSystem":           "strict",
		"ProtectHome":             "yes",
		"ReadWritePaths":          []string{tmp},
		"Environment":             []string{"LANG=C", "PATH=/usr/bin:/bin"},
		"UnsetEnvironment":        blockedNodeEnvironment,
		"CPUQuotaPeriodUSec":      uint64(CPUPeriodUSec),
	}
	for name, value := range want {
		if !sameProperty(got[name], value) {
			t.Fatalf("%s = %#v, want %#v", name, got[name], value)
		}
	}
	if _, ok := got["StandardInputFileDescriptor"]; ok {
		t.Fatal("invalid D-Bus FD property")
	}
	start, ok := got["ExecStart"].([]execStart)
	if !ok || len(start) != 1 || start[0].Path != spec.Command[0] || len(start[0].Args) != 4 || start[0].Args[0] != start[0].Path || start[0].Args[1] != spec.Command[1] || start[0].Args[2] != "/run/crux-anydoc/authorize.sock" || start[0].Args[3] != "/run/crux-anydoc/result.sock" {
		t.Fatalf("unsafe ExecStart %#v", got["ExecStart"])
	}
	paths := got["ReadOnlyPaths"].([]string)
	if len(paths) != 0 {
		t.Fatalf("host socket paths exposed in unit namespace %#v", paths)
	}
	binds, ok := bindReadOnlyPathsValue(got["BindReadOnlyPaths"])
	if !ok || len(binds) != 4 || !same(binds[:2], []string{runtime + ":" + runtimeTarget, input + ":" + stagedSourceTarget}) || !strings.HasPrefix(binds[2], tmp+"/.a-") || !strings.HasSuffix(binds[2], ":/run/crux-anydoc/authorize.sock") || !strings.HasPrefix(binds[3], tmp+"/.r-") || !strings.HasSuffix(binds[3], ":/run/crux-anydoc/result.sock") {
		t.Fatalf("source bind mapping %#v", got["BindReadOnlyPaths"])
	}
	if _, ok := got["BindPaths"]; ok {
		t.Fatal("production spec exposed a writable bind")
	}
}

func TestSystemdProbeUsesOneExactWritableObservationBind(t *testing.T) {
	spec, err := newTestServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	spec.probe = &containmentProbe{hostExecutable: "/run/probe", executableSHA: strings.Repeat("a", 64), action: "network", caseID: "network", resultPath: probeObservationTarget, hostResultPath: "/run/private/observation.json"}
	properties := propertiesByName(systemdProperties(spec))
	binds, ok := bindReadOnlyPathsValue(properties["BindPaths"])
	if !ok || !same(binds, []string{"/run/private:" + probeObservationDirectoryTarget}) {
		t.Fatalf("probe writable bind = %#v", properties["BindPaths"])
	}
}

func TestEligibleLifecycleResourcesAllowsOnlyPositiveSealedPIDsEvidence(t *testing.T) {
	fs := newFakeFS()
	path := cgroupFile("/crux.slice/test", "pids.events")
	for _, test := range []struct {
		name  string
		input string
		want  bool
	}{
		{name: "zero", input: "max 0\n", want: true},
		{name: "one", input: "max 1\n", want: true},
		{name: "greater than one", input: "max 2\n", want: true},
		{name: "malformed line", input: "max 1 extra\n"},
		{name: "malformed key", input: "1max 0\n"},
		{name: "duplicate key", input: "max 0\nmax 1\n"},
		{name: "negative", input: "max -1\n"},
		{name: "overflow", input: "max 9223372036854775808\n"},
		{name: "nondecimal", input: "max 1e3\n"},
	} {
		t.Run("cgroup events/"+test.name, func(t *testing.T) {
			fs.files[path] = []byte(test.input)
			got, err := cgroupEvents(fs, "/crux.slice/test", "pids.events")
			if (err == nil) != test.want {
				t.Fatalf("cgroupEvents(%q) error = %v, want valid = %t", test.input, err, test.want)
			}
			if test.want && got["max"] < 0 {
				t.Fatalf("cgroupEvents(%q) returned unsafe max %d", test.input, got["max"])
			}
		})
	}

	for _, test := range []struct {
		name       string
		memory     map[string]int64
		pidsEvents map[string]int64
		binding    lifecycleWitnessBinding
		want       bool
	}{
		{name: "sealed pids zero", pidsEvents: map[string]int64{"max": 0}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessProbe, probeCase: "pids"}},
		{name: "sealed pids one", pidsEvents: map[string]int64{"max": 1}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessProbe, probeCase: "pids"}, want: true},
		{name: "sealed pids greater than one", pidsEvents: map[string]int64{"max": 2}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessProbe, probeCase: "pids"}, want: true},
		{name: "sealed pids missing max", pidsEvents: map[string]int64{}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessProbe, probeCase: "pids"}},
		{name: "missing oom", memory: map[string]int64{"oom_kill": 0}, pidsEvents: map[string]int64{"max": 0}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessResult}},
		{name: "missing oom kill", memory: map[string]int64{"oom": 0}, pidsEvents: map[string]int64{"max": 0}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessResult}},
		{name: "normal result rejects pids", pidsEvents: map[string]int64{"max": 1}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessResult}},
		{name: "normal result requires explicit zero", pidsEvents: map[string]int64{}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessResult}},
		{name: "normal result accepts explicit zero", pidsEvents: map[string]int64{"max": 0}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessResult}, want: true},
		{name: "unsealed probe rejects pids", pidsEvents: map[string]int64{"max": 1}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessProbe, probeCase: "network"}},
		{name: "unsealed probe requires explicit zero", pidsEvents: map[string]int64{}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessProbe, probeCase: "network"}},
		{name: "unsealed probe accepts explicit zero", pidsEvents: map[string]int64{"max": 0}, binding: lifecycleWitnessBinding{kind: lifecycleWitnessProbe, probeCase: "network"}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			memory := test.memory
			if memory == nil {
				memory = map[string]int64{"oom": 0, "oom_kill": 0}
			}
			snapshot := SandboxReport{MemoryEvents: memory, PIDsEvents: test.pidsEvents}
			if got := eligibleLifecycleResources(snapshot, test.binding); got != test.want {
				t.Fatalf("eligibleLifecycleResources(pids=%#v, binding=%#v) = %t, want %t", test.pidsEvents, test.binding, got, test.want)
			}
		})
	}
}

func TestSystemdProbeCleanupKeepsSharedStageAvailableForLaterStart(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "a-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	runtime := filepath.Join(root, "runtime")
	sharedProbe := filepath.Join(root, "probe")
	for _, path := range []string{runtime, sharedProbe} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	runner := filepath.Join(runtime, "runner.mjs")
	runnerContents := []byte("export {}\n")
	if err := os.WriteFile(runner, runnerContents, 0o555); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtime, ".complete"), nil, 0o444); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	if err := os.WriteFile(source, []byte("probe source"), 0o400); err != nil {
		t.Fatal(err)
	}
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	nodeContents, err := os.ReadFile(nodePath)
	if err != nil {
		t.Fatal(err)
	}
	nodeDigest := fmt.Sprintf("%x", sha256.Sum256(nodeContents))
	runtimeDigest := fmt.Sprintf("%x", sha256.Sum256(runnerContents))
	probePath, probeDigest := stageProbeExecutable(t, sharedProbe)

	backend := NewSystemdBackendWith(SystemdBackendOptions{Bus: newFakeSystemBus(), FileSystem: osFS{}, Clock: immediateClock{}})
	startProbe := func(name string) (*systemdUnit, string) {
		private := filepath.Join(root, name+"-private")
		if err := os.Mkdir(private, 0o700); err != nil {
			t.Fatal(err)
		}
		launch := LaunchDependency{runtimeRoot: runtime, runtimeRunner: runner, runtimeTreeDigest: runtimeDigest, nodePath: nodePath, nodeSHA256: nodeDigest}
		spec, err := serviceSpec(source, launch, private, Limits{})
		if err != nil {
			t.Fatal(err)
		}
		spec.probe = &containmentProbe{hostExecutable: probePath, executableSHA: probeDigest, action: "pids", caseID: "pids", resultPath: probeObservationTarget, hostResultPath: filepath.Join(private, "observation.json")}
		spec.BindReadOnlyPaths = append(spec.BindReadOnlyPaths, probePath+":"+probeTarget)
		read, write, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		defer write.Close()
		unit, err := backend.Start(context.Background(), spec, read)
		if err != nil {
			t.Fatalf("start %s probe: %s", name, safeContainmentDiagnostic(err))
		}
		return unit.(*systemdUnit), private
	}

	first, firstPrivate := startProbe("first")
	if err := first.Cleanup(context.Background()); err != nil {
		t.Fatalf("cleanup first probe: %s", safeContainmentDiagnostic(err))
	}
	if _, err := os.Lstat(firstPrivate); !os.IsNotExist(err) {
		t.Fatalf("first probe private directory retained: %v", err)
	}
	if info, err := os.Lstat(probePath); err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o555 {
		t.Fatalf("shared probe executable removed by first cleanup: %v", err)
	}
	if info, err := os.Lstat(sharedProbe); err != nil || !info.IsDir() {
		t.Fatalf("shared integration stage removed by first cleanup: %v", err)
	}

	second, secondPrivate := startProbe("second")
	if err := second.Cleanup(context.Background()); err != nil {
		t.Fatalf("cleanup second probe: %s", safeContainmentDiagnostic(err))
	}
	if _, err := os.Lstat(secondPrivate); !os.IsNotExist(err) {
		t.Fatalf("second probe private directory retained: %v", err)
	}
}

func TestSystemdBackendFailsClosedForUnavailablePermissionAndCanceledContexts(t *testing.T) {
	spec, _ := newTestServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
	read, write, _ := os.Pipe()
	defer read.Close()
	defer write.Close()
	for _, bus := range []*fakeSystemBus{{fdOK: false}, {startErr: errors.New("access denied")}} {
		if _, err := NewSystemdBackendWith(SystemdBackendOptions{Bus: bus, FileSystem: newFakeFS(), Clock: immediateClock{}}).Start(context.Background(), spec, read); err == nil {
			t.Fatal("expected unavailable backend error")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewSystemdBackendWith(SystemdBackendOptions{Bus: newFakeSystemBus(), FileSystem: newFakeFS(), Clock: immediateClock{}}).Start(ctx, spec, read); err == nil {
		t.Fatal("expected canceled start to fail")
	}
}

func TestContainmentDiagnosticRedactsDBusDetails(t *testing.T) {
	for _, test := range []struct{ name, want string }{{"invalid", "dbus-invalid-args"}, {"unknown", "dbus-other"}} {
		t.Run(test.name, func(t *testing.T) {
			err := containment("start-transient-unit", dbus.Error{Name: "org.freedesktop.DBus.Error." + test.name, Body: []any{"/private/path secret"}})
			if test.name == "invalid" {
				err = containment("start-transient-unit", dbus.Error{Name: "org.freedesktop.DBus.Error.InvalidArgs", Body: []any{"/private/path secret"}})
			}
			var diagnostic *ContainmentError
			if !errors.As(err, &diagnostic) || diagnostic.Stage != "start-transient-unit" || diagnostic.ReasonCode != test.want {
				t.Fatalf("unsafe diagnostic %#v", diagnostic)
			}
			if strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "secret") {
				t.Fatal("diagnostic leaked D-Bus body")
			}
		})
	}
}

func TestSystemdReportReadsActualCgroupLimitsAndRejectsMismatch(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	report, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report.MemoryMax != MemoryCeiling || report.MemoryCurrent != 1024 || report.MemoryPeak != 2048 || report.MemoryEvents["oom_kill"] != 0 || report.MemorySwapMax != 0 || report.TasksMax != TasksCeiling || report.CPUQuotaPercent != CPUQuotaPercent || report.CPUQuotaPeriodUSec != CPUPeriodUSec || !contains(report.ControlGroupMembers, report.MainPID) {
		t.Fatalf("unexpected report %#v", report)
	}
	fs.files[cgroupFile("/crux.slice/test", "cpu.max")] = []byte("max 1000000\n")
	if _, err := unit.Report(context.Background()); err == nil {
		t.Fatal("unbounded CPU was accepted")
	}
}

func TestCaptureTerminalAccountingClassifiesReportValidationSources(t *testing.T) {
	for _, test := range []struct {
		name  string
		apply func(*fakeSystemBus, *fakeFS)
		want  accountingCaptureFailure
	}{
		{name: "report unavailable", apply: func(bus *fakeSystemBus, _ *fakeFS) { bus.propErr = errors.New("private report failure") }, want: accountingCaptureReportValidationDBusFetch},
		{name: "report gone", apply: func(bus *fakeSystemBus, _ *fakeFS) {
			bus.propErr = dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}
		}, want: accountingCaptureReportGone},
		{name: "memory", apply: func(bus *fakeSystemBus, fs *fakeFS) {
			fs.files[cgroupFile("/crux.slice/test", "memory.max")] = []byte("bad")
		}, want: accountingCaptureReportValidationMemory},
		{name: "memory current", apply: func(_ *fakeSystemBus, fs *fakeFS) { delete(fs.files, cgroupFile("/crux.slice/test", "memory.current")) }, want: accountingCaptureReportValidationMemory},
		{name: "memory peak", apply: func(_ *fakeSystemBus, fs *fakeFS) { delete(fs.files, cgroupFile("/crux.slice/test", "memory.peak")) }, want: accountingCaptureReportValidationMemory},
		{name: "memory events", apply: func(_ *fakeSystemBus, fs *fakeFS) {
			fs.files[cgroupFile("/crux.slice/test", "memory.events")] = []byte("max bad")
		}, want: accountingCaptureReportValidationCgroupAccounting},
		{name: "cpu stat", apply: func(_ *fakeSystemBus, fs *fakeFS) {
			fs.files[cgroupFile("/crux.slice/test", "cpu.stat")] = []byte("usage_usec bad")
		}, want: accountingCaptureReportValidationCgroupAccounting},
		{name: "pids events", apply: func(_ *fakeSystemBus, fs *fakeFS) {
			fs.files[cgroupFile("/crux.slice/test", "pids.events")] = []byte("max bad")
		}, want: accountingCaptureReportValidationCgroupAccounting},
		{name: "cgroup procs", apply: func(_ *fakeSystemBus, fs *fakeFS) {
			fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = []byte("bad")
		}, want: accountingCaptureReportValidationCgroupAccounting},
		{name: "cgroup events unavailable", apply: func(_ *fakeSystemBus, fs *fakeFS) {
			fs.readErr[cgroupFile("/crux.slice/test", "cgroup.events")] = errors.New("private cgroup read failure")
		}, want: accountingCaptureReportValidationCgroupAccounting},
		{name: "cgroup events malformed", apply: func(_ *fakeSystemBus, fs *fakeFS) {
			fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("bad")
		}, want: accountingCaptureReportValidationCgroupAccounting},
		{name: "cpu unavailable", apply: func(_ *fakeSystemBus, fs *fakeFS) { fs.failReadAt[cgroupFile("/crux.slice/test", "cpu.stat")] = 2 }, want: accountingCaptureCPUUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			fs := newFakeFS()
			test.apply(bus, fs)
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
			_, _, failure, err := unit.CaptureTerminalAccounting(context.Background())
			if err == nil || failure != test.want {
				t.Fatalf("capture = failure %v err %v, want failure %v and an error", failure, err, test.want)
			}
			if reason := failure.reason(); reason == "" || !validContainmentReason(reason) || strings.Contains(reason, "private") {
				t.Fatalf("failure reason = %q, must be allowlisted and non-sensitive", reason)
			}
			if strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "/sys/fs/cgroup") {
				t.Fatalf("report validation error leaked sensitive source: %v", err)
			}
		})
	}
}

func TestCaptureTerminalAccountingUsesOnlyVerifiedTerminalRuntimeSnapshot(t *testing.T) {
	newUnit := func(t *testing.T, verified bool) *systemdUnit {
		t.Helper()
		fs := newFakeFS()
		unit := &systemdUnit{name: "crux-anydoc-terminal-runtime.service", bus: newFakeSystemBus(), fs: fs, procFS: fs, now: immediateClock{}}
		first, err := unit.Report(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
		if _, err := unit.Report(context.Background()); err != nil {
			t.Fatal(err)
		}
		if verified {
			unit.MarkSnapshotVerified()
		}
		unit.procFS = missingProcRuntimeFS{}
		return unit
	}

	t.Run("accepts disappeared proc after exit", func(t *testing.T) {
		unit := newUnit(t, true)
		unit.bus.(*fakeSystemBus).values["ActiveState"] = "inactive"
		unit.procFS = missingProcRuntimeFS{}

		report, _, failure, err := unit.CaptureTerminalAccounting(context.Background())
		if err != nil || failure != accountingCaptureOK {
			t.Fatalf("capture = %#v, %v, %v; want verified terminal success", report, failure, err)
		}
		if report.RuntimeTreeDigest != unit.spec.runtimeTreeDigest {
			t.Fatal("terminal report did not retain the verified runtime identity")
		}
	})

	for _, test := range []struct {
		name    string
		apply   func(*systemdUnit)
		failure accountingCaptureFailure
	}{
		{name: "active unit", apply: func(unit *systemdUnit) { unit.bus.(*fakeSystemBus).values["ActiveState"] = "active" }, failure: accountingCaptureReportValidationRuntimeAttestationSnapshotIdentityMismatch},
		{name: "unverified snapshot", apply: func(unit *systemdUnit) { unit.snapshotOK = false }, failure: accountingCaptureReportValidationRuntimeAttestationSnapshotIdentityMismatch},
		{name: "runtime identity mutation", apply: func(unit *systemdUnit) {
			fs := unit.fs.(*fakeFS)
			fs.runtimeContents = []byte("mutated")
			unit.procFS = fs
		}, failure: accountingCaptureReportValidationRuntimeAttestationRuntimeDigestMismatch},
		{name: "malformed proc entry", apply: func(unit *systemdUnit) {
			fs := unit.fs.(*fakeFS)
			fs.runtimeRootMode = os.ModeSymlink | 0o777
			unit.procFS = fs
		}, failure: accountingCaptureReportValidationRuntimeAttestationRuntimeTreeUnsafe},
		{name: "pid mismatch", apply: func(unit *systemdUnit) {
			unit.bus.(*fakeSystemBus).values["MainPID"] = uint32(43)
			unit.procFS = missingProcRuntimeFS{}
		}, failure: accountingCaptureReportValidationRuntimeAttestationSnapshotIdentityMismatch},
	} {
		t.Run(test.name, func(t *testing.T) {
			unit := newUnit(t, true)
			unit.bus.(*fakeSystemBus).values["ActiveState"] = "inactive"
			unit.procFS = missingProcRuntimeFS{}
			test.apply(unit)

			_, _, failure, err := unit.CaptureTerminalAccounting(context.Background())
			if err == nil || failure != test.failure {
				t.Fatalf("capture = failure %v err %v, want failure %v", failure, err, test.failure)
			}
		})
	}
}

func TestFinishReportsTypedTerminalRuntimeAttestationDiagnostics(t *testing.T) {
	for _, test := range []struct {
		name   string
		procFS ProcRuntimeFS
		mutate func(*systemdUnit, *fakeSystemBus, *fakeFS)
		want   string
	}{
		{name: "proc root unavailable", procFS: procRuntimeFSFunc{lstat: func(string) (os.FileInfo, error) { return nil, errors.New("/private/proc") }}, want: "terminal-accounting-report-runtime-attestation-proc-root-unavailable"},
		{name: "proc root unsafe", procFS: procRuntimeFSFunc{lstat: func(string) (os.FileInfo, error) { return fakeRuntimeInfo{mode: os.ModeDir | 0o555}, nil }}, want: "terminal-accounting-report-runtime-attestation-proc-root-unsafe"},
		{name: "runtime target missing without lifecycle witness stays rejected", procFS: procRuntimeFSFunc{lstat: func(path string) (os.FileInfo, error) {
			if strings.HasSuffix(path, "/root") {
				return fakeRuntimeInfo{mode: os.ModeSymlink | 0o777}, nil
			}
			return nil, os.ErrNotExist
		}}, want: "runtime-target-missing-ack-witness-absent"},
		{name: "runtime tree unreadable", procFS: procRuntimeFSFunc{lstat: func(path string) (os.FileInfo, error) {
			if strings.HasSuffix(path, "/root") {
				return fakeRuntimeInfo{mode: os.ModeSymlink | 0o777}, nil
			}
			return fakeRuntimeInfo{mode: os.ModeDir | 0o555}, nil
		}, readDir: func(string) ([]os.DirEntry, error) { return nil, errors.New("/private/tree") }}, want: "runtime-target-missing-ack-witness-absent"},
		{name: "runtime digest mismatch", mutate: func(unit *systemdUnit, _ *fakeSystemBus, fs *fakeFS) {
			fs.runtimeContents = []byte("mutated")
			unit.procFS = fs
		}, want: "terminal-accounting-report-runtime-attestation-runtime-digest-mismatch"},
		{name: "verified snapshot identity mismatch", procFS: missingProcRuntimeFS{}, mutate: func(_ *systemdUnit, bus *fakeSystemBus, _ *fakeFS) { bus.values["ActiveState"] = "active" }, want: "terminal-accounting-report-runtime-attestation-snapshot-identity-mismatch"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fs := newFakeFS()
			bus := newFakeSystemBus()
			unit := &systemdUnit{name: "crux-anydoc-terminal-runtime.service", bus: bus, fs: fs, procFS: fs, now: immediateClock{}}
			first, err := unit.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
			if _, err := unit.Report(context.Background()); err != nil {
				t.Fatal(err)
			}
			unit.MarkSnapshotVerified()
			if test.procFS != nil {
				unit.procFS = test.procFS
			}
			if test.mutate != nil {
				test.mutate(unit, bus, fs)
			}
			bus.onStop = func() {
				bus.values["ActiveState"] = "inactive"
				bus.values["MainPID"] = uint32(0)
				fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
				fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = []byte{}
			}

			staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
			if err != nil {
				t.Fatal(err)
			}
			_, write, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			run := &Run{unit: unit, write: write, staged: staged, stop: make(chan struct{}), finished: make(chan struct{}), started: time.Now()}
			finishErr := run.Finish(context.Background(), nil)
			terminal := run.TerminalReport()
			got := safeExecutionFailure(finishErr, terminal)
			if !strings.Contains(got, "stage=containment-cleanup reason="+test.want) || strings.Contains(got, "private") || strings.Contains(got, "/proc") {
				t.Fatalf("safe diagnostic = %q, want sanitized reason %q", got, test.want)
			}
		})
	}
}

func TestMountedRuntimeDigestOnlyTreatsExactProcRootAbsenceAsDisappearance(t *testing.T) {
	procRoot := filepath.Join("/proc", "42", "root")
	runtimeRoot := filepath.Join(procRoot, strings.TrimPrefix(runtimeTarget, "/"))

	rootGone := procRuntimeFSFunc{lstat: func(string) (os.FileInfo, error) { return nil, os.ErrNotExist }}
	if _, err := mountedRuntimeDigest(rootGone, 42); !runtimeProcDisappeared(err, 42) {
		t.Fatalf("root absence = %v, want typed proc disappearance", err)
	}

	targetGone := procRuntimeFSFunc{lstat: func(path string) (os.FileInfo, error) {
		if path == procRoot {
			return fakeRuntimeInfo{name: "root", mode: os.ModeSymlink | 0o777}, nil
		}
		if path == runtimeRoot {
			return nil, os.ErrNotExist
		}
		return nil, os.ErrNotExist
	}}
	if _, err := mountedRuntimeDigest(targetGone, 42); err == nil || runtimeProcDisappeared(err, 42) {
		t.Fatalf("runtime target absence = %v, want non-fallback rejection", err)
	}

	malformed := procRuntimeFSFunc{lstat: func(path string) (os.FileInfo, error) {
		if path == procRoot {
			return fakeRuntimeInfo{name: "root", mode: os.ModeDir | 0o555}, nil
		}
		return nil, os.ErrNotExist
	}}
	if _, err := mountedRuntimeDigest(malformed, 42); err == nil || runtimeProcDisappeared(err, 42) {
		t.Fatalf("malformed proc root = %v, want non-fallback rejection", err)
	}
}

type procRuntimeFSFunc struct {
	lstat   func(string) (os.FileInfo, error)
	readDir func(string) ([]os.DirEntry, error)
}

func (f procRuntimeFSFunc) Lstat(path string) (os.FileInfo, error) { return f.lstat(path) }
func (f procRuntimeFSFunc) ReadDir(path string) ([]os.DirEntry, error) {
	if f.readDir != nil {
		return f.readDir(path)
	}
	return nil, os.ErrNotExist
}
func (procRuntimeFSFunc) ReadFile(string) ([]byte, error) { return nil, os.ErrNotExist }

func unreadableRuntimeTreeFS() ProcRuntimeFS {
	return procRuntimeFSFunc{
		lstat: func(path string) (os.FileInfo, error) {
			if strings.HasSuffix(path, "/root") {
				return fakeRuntimeInfo{mode: os.ModeSymlink | 0o777}, nil
			}
			return fakeRuntimeInfo{mode: os.ModeDir | 0o555}, nil
		},
		readDir: func(string) ([]os.DirEntry, error) {
			return nil, errors.New("runtime tree unreadable")
		},
	}
}

func unsafeRuntimeTreeFS() ProcRuntimeFS {
	return procRuntimeFSFunc{lstat: func(path string) (os.FileInfo, error) {
		if strings.HasSuffix(path, "/root") {
			return fakeRuntimeInfo{mode: os.ModeSymlink | 0o777}, nil
		}
		return fakeRuntimeInfo{mode: os.ModeSymlink | 0o777}, nil
	}}
}

func TestReportValidationCodeAccountingMappings(t *testing.T) {
	for _, test := range []struct {
		code    ReportValidationCode
		failure accountingCaptureFailure
	}{
		{code: reportValidationDBusFetch, failure: accountingCaptureReportValidationDBusFetch},
		{code: reportValidationControlGroup, failure: accountingCaptureReportValidationControlGroup},
		{code: reportValidationMemory, failure: accountingCaptureReportValidationMemory},
		{code: reportValidationCgroupAccounting, failure: accountingCaptureReportValidationCgroupAccounting},
		{code: reportValidationMemoryEvents, failure: accountingCaptureReportValidationMemoryEvents},
		{code: reportValidationCPUStat, failure: accountingCaptureReportValidationCPUStat},
		{code: reportValidationPIDsEvents, failure: accountingCaptureReportValidationPIDsEvents},
		{code: reportValidationCgroupProcs, failure: accountingCaptureReportValidationCgroupProcs},
		{code: reportValidationCgroupEvents, failure: accountingCaptureReportValidationCgroupEvents},
		{code: reportValidationSwap, failure: accountingCaptureReportValidationSwap},
		{code: reportValidationTasks, failure: accountingCaptureReportValidationTasks},
		{code: reportValidationCPU, failure: accountingCaptureReportValidationCPU},
		{code: reportValidationSandboxProperties, failure: accountingCaptureReportValidationSandboxProperties},
		{code: reportValidationRuntimeAttestationProcRootUnavailable, failure: accountingCaptureReportValidationRuntimeAttestationProcRootUnavailable},
		{code: reportValidationRuntimeAttestationProcRootUnsafe, failure: accountingCaptureReportValidationRuntimeAttestationProcRootUnsafe},
		{code: reportValidationRuntimeAttestationRuntimeTargetMissing, failure: accountingCaptureReportValidationRuntimeAttestationRuntimeTargetMissing},
		{code: reportValidationRuntimeAttestationRuntimeTreeUnsafe, failure: accountingCaptureReportValidationRuntimeAttestationRuntimeTreeUnsafe},
		{code: reportValidationRuntimeAttestationRuntimeTreeUnreadable, failure: accountingCaptureReportValidationRuntimeAttestationRuntimeTreeUnreadable},
		{code: reportValidationRuntimeAttestationRuntimeDigestMismatch, failure: accountingCaptureReportValidationRuntimeAttestationRuntimeDigestMismatch},
		{code: reportValidationRuntimeAttestationSnapshotIdentityMismatch, failure: accountingCaptureReportValidationRuntimeAttestationSnapshotIdentityMismatch},
	} {
		t.Run(string(test.code), func(t *testing.T) {
			if got := reportValidationCaptureFailure(test.code); got != test.failure {
				t.Fatalf("capture failure = %v, want %v", got, test.failure)
			}
			code, ok := reportValidationCodeForCaptureFailure(test.failure)
			if !ok || code != test.code {
				t.Fatalf("validation code = %q, %t; want %q, true", code, ok, test.code)
			}
			wantReason := "terminal-accounting-report-" + string(test.code)
			if got := test.failure.reason(); got != wantReason || !validContainmentReason(got) {
				t.Fatalf("reason = %q, want allowlisted %q", got, wantReason)
			}
		})
	}
}

func TestSystemdReportValidationErrorsDoNotLeakFakeSources(t *testing.T) {
	for _, test := range []struct {
		name  string
		apply func(*fakeSystemBus, *fakeFS)
		want  ReportValidationCode
	}{
		{name: "dbus", apply: func(bus *fakeSystemBus, _ *fakeFS) { bus.propErr = errors.New("private D-Bus value /secret") }, want: reportValidationDBusFetch},
		{name: "cgroup", apply: func(bus *fakeSystemBus, _ *fakeFS) { bus.values["ControlGroup"] = "relative/private-secret" }, want: reportValidationControlGroup},
		{name: "memory events", apply: func(_ *fakeSystemBus, fs *fakeFS) {
			fs.readErr[cgroupFile("/crux.slice/test", "memory.events")] = errors.New("/private/cgroup/accounting-secret")
		}, want: reportValidationMemoryEvents},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			fs := newFakeFS()
			test.apply(bus, fs)
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
			_, err := unit.Report(context.Background())
			var validation *ReportValidationError
			if !errors.As(err, &validation) || validation.Code != test.want {
				t.Fatalf("Report error = %v, want validation code %q", err, test.want)
			}
			if strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "/") {
				t.Fatalf("Report error leaked fake source: %v", err)
			}
		})
	}
}

func TestPostStartReportCgroupAccountingDiagnosticsAreGranularAndSafe(t *testing.T) {
	for _, test := range []struct {
		name      string
		file      string
		malformed []byte
		want      string
	}{
		{name: "memory events", file: "memory.events", malformed: []byte("oom private-value\n"), want: "report-memory-events"},
		{name: "cpu stat", file: "cpu.stat", malformed: []byte("usage_usec private-value\n"), want: "report-cpu-stat"},
		{name: "pids events", file: "pids.events", malformed: []byte("max private-value\n"), want: "report-pids-events"},
		{name: "cgroup procs", file: "cgroup.procs", malformed: []byte("private-value\n"), want: "report-cgroup-procs"},
		{name: "cgroup events", file: "cgroup.events", malformed: []byte("malformed-record\n"), want: "report-cgroup-events"},
	} {
		for _, mode := range []string{"missing", "malformed"} {
			t.Run(test.name+" "+mode, func(t *testing.T) {
				fs := newFakeFS()
				path := cgroupFile("/crux.slice/test", test.file)
				if mode == "missing" {
					delete(fs.files, path)
				} else {
					fs.files[path] = test.malformed
				}

				unit := &systemdUnit{name: "crux-anydoc-test.service", bus: newFakeSystemBus(), fs: fs, now: immediateClock{}}
				_, err := unit.Report(context.Background())
				diagnostic := startDiagnostic("post-start-report", err)
				if diagnostic.ReasonCode != test.want || !validContainmentReason(diagnostic.ReasonCode) {
					t.Fatalf("post-start diagnostic = %q, want allowlisted %q", diagnostic.Error(), test.want)
				}
				if strings.Contains(diagnostic.Error(), "private") || strings.Contains(diagnostic.Error(), "/") {
					t.Fatalf("post-start diagnostic leaked fake source: %q", diagnostic.Error())
				}
			})
		}
	}
}

func TestSystemdReportClassifiesOnlyExactUnitPropertiesGoneErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want accountingCaptureFailure
	}{
		{name: "no such unit", err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, want: accountingCaptureReportGone},
		{name: "unknown object", err: dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject"}, want: accountingCaptureReportGone},
		{name: "other dbus error", err: dbus.Error{Name: "org.freedesktop.systemd1.AccessDenied"}, want: accountingCaptureReportValidationDBusFetch},
		{name: "untyped error", err: errors.New("private unavailable"), want: accountingCaptureReportValidationDBusFetch},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			bus.propErr = test.err
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}}
			_, _, failure, err := unit.CaptureTerminalAccounting(context.Background())
			if err == nil || failure != test.want {
				t.Fatalf("capture = failure %v err %v, want failure %v and an error", failure, err, test.want)
			}
			if reason := failure.reason(); !validContainmentReason(reason) || strings.Contains(reason, "private") {
				t.Fatalf("failure reason = %q, must be allowlisted and non-sensitive", reason)
			}
		})
	}
}

func TestSystemdReportPreservesNonGoneOperationErrorsOutsideTerminalAccounting(t *testing.T) {
	for _, test := range []struct {
		name  string
		class terminalStatusDBusClass
	}{
		{name: "unrecognized", class: terminalStatusDBusUnrecognized},
		{name: "transport", class: terminalStatusDBusGeneric},
	} {
		t.Run(test.name, func(t *testing.T) {
			operation := &terminalStatusOperationError{
				stage:     terminalStatusUnitProperties,
				dbusClass: test.class,
			}
			bus := newFakeSystemBus()
			bus.propErr = operation
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}}

			_, reportErr := unit.Report(context.Background())
			var reportOperation *terminalStatusOperationError
			var reportCapture *terminalAccountingCaptureError
			if !errors.As(reportErr, &reportOperation) || reportOperation != operation || errors.As(reportErr, &reportCapture) {
				t.Fatalf("Report() = %T %v, want direct sanitized operation error", reportErr, reportErr)
			}

			_, _, failure, captureErr := unit.CaptureTerminalAccounting(context.Background())
			var capture *terminalAccountingCaptureError
			var captureOperation *terminalStatusOperationError
			if failure != accountingCaptureReportValidationDBusFetch || !errors.As(captureErr, &capture) || capture.err != operation || !errors.As(captureErr, &captureOperation) || captureOperation != operation {
				t.Fatalf("CaptureTerminalAccounting() = failure %v err %T %v, want wrapped sanitized operation error", failure, captureErr, captureErr)
			}
		})
	}
}

func TestCaptureTerminalAccountingPrefersExactCgroupENOENTOverReportGone(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	for path := range fs.files {
		if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
			delete(fs.files, path)
		}
	}
	bus.propErr = dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}

	_, _, failure, err := unit.CaptureTerminalAccounting(context.Background())
	if err == nil || failure != accountingCaptureExactCgroupAbsent {
		t.Fatalf("capture = failure %v err %v, want exact-cgroup ENOENT", failure, err)
	}
}

func TestCleanupReusesSnapshotOnlyForReportGoneWithStrictTerminalEvidence(t *testing.T) {
	strictTerminal := TerminalStatus{State: "inactive", ServiceResult: "success"}
	pinned := SandboxReport{ControlGroup: "/crux.slice/pinned"}

	for _, test := range []struct {
		name        string
		failure     accountingCaptureFailure
		termination func(context.Context, string) (TerminationEvidence, error)
		status      TerminalStatus
		want        string
	}{
		{name: "lingering cgroup becomes empty", failure: accountingCaptureReportGone, status: strictTerminal, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: pinned.ControlGroup, Empty: true}, nil
		}},
		{name: "cgroup absent", failure: accountingCaptureReportGone, status: strictTerminal, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: pinned.ControlGroup, Absent: true}, nil
		}},
		{name: "report unavailable", failure: accountingCaptureReportUnavailable, status: strictTerminal, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: pinned.ControlGroup, Empty: true}, nil
		}, want: "terminal-accounting-report-unavailable"},
		{name: "malformed report", failure: accountingCaptureReportInvalid, status: strictTerminal, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: pinned.ControlGroup, Empty: true}, nil
		}, want: "terminal-accounting-report-invalid"},
		{name: "live descendants", failure: accountingCaptureReportGone, status: strictTerminal, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{}, errors.New("populated private cgroup")
		}, want: "termination-evidence"},
		{name: "cgroup mismatch", failure: accountingCaptureReportGone, status: strictTerminal, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: "/crux.slice/other", Empty: true}, nil
		}, want: "termination-evidence"},
		{name: "terminal unavailable", failure: accountingCaptureReportGone, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: pinned.ControlGroup, Empty: true}, nil
		}, want: "already-gone-terminal-unavailable"},
		{name: "live terminal", failure: accountingCaptureReportGone, status: TerminalStatus{State: "active", MainPID: 42, ServiceResult: "success"}, termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: pinned.ControlGroup, Empty: true}, nil
		}, want: "already-gone-terminal-not-success"},
	} {
		t.Run(test.name, func(t *testing.T) {
			unit := &terminalAccountingFakeUnit{
				fakeUnit: fakeUnit{
					snapshot:       pinned,
					snapshotCPU:    time.Microsecond,
					snapshotOK:     true,
					terminalStatus: func(context.Context) (TerminalStatus, error) { return test.status, nil },
					termination:    test.termination,
				},
				failure: test.failure,
				err:     errors.New("private report failure"),
			}
			if test.name == "terminal unavailable" {
				unit.terminalStatus = func(context.Context) (TerminalStatus, error) {
					return TerminalStatus{}, errors.New("private terminal status failure")
				}
			}
			_, _, _, reason := cleanup(unit)
			if reason != test.want {
				t.Fatalf("cleanup reason = %q, want %q", reason, test.want)
			}
			if reason != "" && (!validContainmentReason(reason) || strings.Contains(reason, "private")) {
				t.Fatalf("cleanup reason = %q, must be allowlisted and non-sensitive", reason)
			}
		})
	}
}

func TestReportGoneTerminalOperationErrorKeepsSafeDiagnosticStage(t *testing.T) {
	pinned := SandboxReport{ControlGroup: "/crux.slice/pinned", ServiceResult: "success"}
	newUnit := func() *terminalAccountingFakeUnit {
		return &terminalAccountingFakeUnit{
			fakeUnit: fakeUnit{
				snapshot:   pinned,
				snapshotOK: true,
				terminalStatus: func(context.Context) (TerminalStatus, error) {
					return TerminalStatus{}, &terminalStatusOperationError{stage: terminalStatusUnitProperties, dbusClass: terminalStatusDBusGeneric}
				},
				termination: func(context.Context, string) (TerminationEvidence, error) {
					return TerminationEvidence{ControlGroup: pinned.ControlGroup, Empty: true}, nil
				},
			},
			failure: accountingCaptureReportGone,
			err:     errors.New("private report failure"),
		}
	}

	_, _, _, reason := cleanup(newUnit())
	if reason != "already-gone-terminal-unit-properties-unavailable" {
		t.Fatalf("cleanup reason = %q, want granular terminal operation reason", reason)
	}

	staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
	if err != nil {
		t.Fatal(err)
	}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()

	run := &Run{
		unit:     newUnit(),
		write:    write,
		staged:   staged,
		stop:     make(chan struct{}),
		finished: make(chan struct{}),
		started:  time.Now(),
	}
	finishErr := run.Finish(context.Background(), nil)
	terminal := run.TerminalReport()
	if terminal.Outcome != ErrContainmentUnavailable || terminal.Cleaned {
		t.Fatalf("terminal report = %#v, want containment-unavailable and Cleaned false", terminal)
	}
	if terminal.PreStop.ServiceResult != "success" {
		t.Fatalf("terminal service result = %q, want success from verified snapshot", terminal.PreStop.ServiceResult)
	}

	const want = "error=containment-unavailable outcome=containment-unavailable service=success stage=containment-cleanup reason=already-gone-terminal-unit-properties-unavailable oom-killed=false pids-limited=false"
	if got := safeExecutionFailure(finishErr, terminal); got != want {
		t.Fatalf("safe diagnostic = %q, want %q", got, want)
	}
}

func TestUnitPropertiesGoneTerminalOperationErrorKeepsSafeDiagnosticStage(t *testing.T) {
	pinned := "/crux.slice/pinned"
	newUnit := func() *fakeUnit {
		return &fakeUnit{
			rep:        SandboxReport{ControlGroup: pinned, ServiceResult: "success"},
			stopErr:    &stopFailure{reason: "unit-properties-gone"},
			snapshot:   SandboxReport{ControlGroup: pinned, MainPID: 42, RuntimeTreeDigest: "verified"},
			snapshotOK: true,
			terminalProof: terminalSuccessProof{
				status:        TerminalStatus{State: "inactive", ServiceResult: "success"},
				cgroup:        pinned,
				snapshotPID:   42,
				runtimeDigest: "verified",
			},
			terminalProofOK: true,
			terminalStatus: func(context.Context) (TerminalStatus, error) {
				return TerminalStatus{}, &terminalStatusOperationError{stage: terminalStatusUnitProperties, dbusClass: terminalStatusDBusGeneric}
			},
			termination: func(context.Context, string) (TerminationEvidence, error) {
				return TerminationEvidence{ControlGroup: pinned, Absent: true}, nil
			},
		}
	}

	staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
	if err != nil {
		t.Fatal(err)
	}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()

	run := &Run{
		unit:     newUnit(),
		write:    write,
		staged:   staged,
		stop:     make(chan struct{}),
		finished: make(chan struct{}),
		started:  time.Now(),
	}
	finishErr := run.Finish(context.Background(), nil)
	terminal := run.TerminalReport()
	if terminal.Outcome != ErrContainmentUnavailable || terminal.Cleaned {
		t.Fatalf("terminal report = %#v, want containment-unavailable and Cleaned false", terminal)
	}

	const want = "error=containment-unavailable outcome=containment-unavailable service=success stage=containment-cleanup reason=already-gone-terminal-unit-properties-unavailable oom-killed=false pids-limited=false"
	if got := safeExecutionFailure(finishErr, terminal); got != want {
		t.Fatalf("safe diagnostic = %q, want %q", got, want)
	}
}

func TestReportGoneTerminalDecodeFailureKeepsSafeDiagnosticStage(t *testing.T) {
	pinned := SandboxReport{ControlGroup: "/crux.slice/pinned", ServiceResult: "success"}
	newUnit := func() *terminalAccountingFakeUnit {
		return &terminalAccountingFakeUnit{
			fakeUnit: fakeUnit{
				snapshot:   pinned,
				snapshotOK: true,
				terminalStatus: func(context.Context) (TerminalStatus, error) {
					return TerminalStatus{}, &terminalStatusUnavailableError{stage: terminalStatusDecode}
				},
				termination: func(context.Context, string) (TerminationEvidence, error) {
					return TerminationEvidence{ControlGroup: pinned.ControlGroup, Empty: true}, nil
				},
			},
			failure: accountingCaptureReportGone,
			err:     errors.New("private report failure"),
		}
	}

	_, _, _, reason := cleanup(newUnit())
	if reason != "already-gone-terminal-decode-unavailable" {
		t.Fatalf("cleanup reason = %q, want decode terminal reason", reason)
	}

	staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
	if err != nil {
		t.Fatal(err)
	}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()

	run := &Run{
		unit:     newUnit(),
		write:    write,
		staged:   staged,
		stop:     make(chan struct{}),
		finished: make(chan struct{}),
		started:  time.Now(),
	}
	finishErr := run.Finish(context.Background(), nil)
	terminal := run.TerminalReport()
	if terminal.Outcome != ErrContainmentUnavailable || terminal.Cleaned {
		t.Fatalf("terminal report = %#v, want containment-unavailable and Cleaned false", terminal)
	}

	const want = "error=containment-unavailable outcome=containment-unavailable service=success stage=containment-cleanup reason=already-gone-terminal-decode-unavailable oom-killed=false pids-limited=false"
	if got := safeExecutionFailure(finishErr, terminal); got != want {
		t.Fatalf("safe diagnostic = %q, want %q", got, want)
	}
}

func TestCleanupRejectsReportGoneSnapshotWithMismatchedPinnedCgroup(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-mismatched-snapshot.service", bus: bus, fs: fs, now: immediateClock{}}
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	unit.MarkSnapshotVerified()

	unit.snapshotMu.Lock()
	unit.snapshot.ControlGroup = "/crux.slice/other"
	unit.snapshotMu.Unlock()
	bus.propErr = dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}

	_, _, _, reason := cleanup(unit)
	if reason != "terminal-accounting-report-gone" {
		t.Fatalf("cleanup reason = %q, want terminal-accounting-report-gone", reason)
	}
}

func TestCleanupSystemdReportGoneReusesExactVerifiedSnapshotWithStrictEvidence(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-report-gone.service", bus: bus, fs: fs, now: immediateClock{}}

	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := unit.CPUUsage(context.Background()); err != nil {
		t.Fatal(err)
	}
	unit.MarkSnapshotVerified()

	bus.propGoneOnce = true
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	bus.values["ExecMainStatus"] = int32(0)
	bus.onStop = func() {
		fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
		fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = []byte{}
	}

	report, _, termination, reason := cleanup(unit)
	if reason != "" {
		t.Fatalf("cleanup reason = %q, want success", reason)
	}
	if report.ControlGroup != first.ControlGroup {
		t.Fatalf("cleanup report cgroup = %q, want verified %q", report.ControlGroup, first.ControlGroup)
	}
	if termination != (TerminationEvidence{ControlGroup: first.ControlGroup, Empty: true}) {
		t.Fatalf("termination = %#v, want exact empty evidence for %q", termination, first.ControlGroup)
	}
}

func TestCleanupReportGoneRequiresStrictTerminalEvidence(t *testing.T) {
	strict := TerminalStatus{State: "inactive", ServiceResult: "success"}
	pinned := SandboxReport{ControlGroup: "/crux.slice/pinned"}

	for _, test := range []struct {
		name      string
		status    TerminalStatus
		statusErr error
		want      string
	}{
		{name: "carried proof with typed gone status accepts", statusErr: &terminalStatusGoneError{}},
		{name: "carried proof with generic status error rejects", statusErr: errors.New("terminal unavailable"), want: "already-gone-terminal-unavailable"},
		{name: "carried proof with unrecognized D-Bus status rejects", statusErr: &terminalStatusUnrecognizedDBusError{}, want: "already-gone-terminal-unrecognized-dbus"},
		{name: "failed terminal rejects", status: TerminalStatus{State: "failed", ServiceResult: "exit-code", ExecMainStatus: 1}, want: "already-gone-terminal-not-success"},
		{name: "inactive success with nonzero main status rejects", status: TerminalStatus{State: "inactive", ServiceResult: "success", ExecMainStatus: 1}, want: "already-gone-terminal-not-success"},
	} {
		t.Run(test.name, func(t *testing.T) {
			unit := &terminalAccountingFakeUnit{
				fakeUnit: fakeUnit{
					snapshot:   pinned,
					snapshotOK: true,
					stopErr:    &alreadyGoneError{proof: strict, cgroup: pinned.ControlGroup},
					terminalStatus: func(context.Context) (TerminalStatus, error) {
						return test.status, test.statusErr
					},
					termination: func(context.Context, string) (TerminationEvidence, error) {
						return TerminationEvidence{ControlGroup: pinned.ControlGroup, Absent: true}, nil
					},
				},
				failure: accountingCaptureReportGone,
				err:     errors.New("unit properties gone"),
			}

			_, _, _, reason := cleanup(unit)
			if reason != test.want {
				t.Fatalf("cleanup reason = %q, want %q", reason, test.want)
			}
			if reason != "" && !validContainmentReason(reason) {
				t.Fatalf("cleanup reason is not allowlisted: %q", reason)
			}
		})
	}
}

func TestSystemdReportRejectsMalformedBindAndProtectHomeProperties(t *testing.T) {
	for _, test := range []struct {
		name  string
		key   string
		value any
	}{
		{name: "legacy bind string array", key: "BindReadOnlyPaths", value: []string{"/source:/target"}},
		{name: "bind ignores missing", key: "BindReadOnlyPaths", value: []any{[]any{"/source", "/target", true, uint64(0)}}},
		{name: "bind mount flags", key: "BindReadOnlyPaths", value: []any{[]any{"/source", "/target", false, uint64(1)}}},
		{name: "malformed writable bind", key: "BindPaths", value: []any{[]any{"/source", "/target", false, uint64(1)}}},
		{name: "boolean protect home", key: "ProtectHome", value: true},
		{name: "non-enforcing protect home", key: "ProtectHome", value: "read-only"},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			bus.values[test.key] = test.value
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}}
			if _, err := unit.Report(context.Background()); err == nil {
				t.Fatal("malformed sandbox property accepted")
			}
		})
	}
}

func TestSystemdTerminationEvidenceRequiresOriginalCgroupToBeEmptyOrAbsent(t *testing.T) {
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-test.service", bus: newFakeSystemBus(), fs: fs, now: immediateClock{}}
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}

	fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
	fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = nil
	evidence, err := unit.TerminationEvidence(context.Background(), "/crux.slice/test")
	if err != nil || evidence != (TerminationEvidence{ControlGroup: "/crux.slice/test", Empty: true}) {
		t.Fatalf("empty original cgroup evidence = %#v, %v", evidence, err)
	}

	delete(fs.files, cgroupFile("/crux.slice/test", "cgroup.events"))
	delete(fs.files, cgroupFile("/crux.slice/test", "cgroup.procs"))
	evidence, err = unit.TerminationEvidence(context.Background(), "/crux.slice/test")
	if err != nil || evidence != (TerminationEvidence{ControlGroup: "/crux.slice/test", Absent: true}) {
		t.Fatalf("absent original cgroup evidence = %#v, %v", evidence, err)
	}

	if _, err := unit.TerminationEvidence(context.Background(), "/crux.slice/other"); err == nil {
		t.Fatal("different cgroup accepted as termination evidence")
	}
}

func TestCleanupUsesVerifiedSnapshotWhenExactCgroupENOENT(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := unit.CPUUsage(context.Background()); err != nil {
		t.Fatal(err)
	}
	unit.MarkSnapshotVerified()
	for path := range fs.files {
		if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
			delete(fs.files, path)
		}
	}
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	report, cpu, termination, reason := cleanup(unit)
	if reason != "" || report.ControlGroup != "/crux.slice/test" || cpu != 11*time.Microsecond || !termination.Absent {
		t.Fatalf("vanished-cgroup cleanup = report %#v cpu %s termination %#v reason %q", report, cpu, termination, reason)
	}

	unverified := &systemdUnit{name: "crux-anydoc-unverified.service", bus: bus, fs: fs, now: immediateClock{}, controlGroup: "/crux.slice/test"}
	if _, _, _, reason := cleanup(unverified); reason == "" {
		t.Fatal("vanished cgroup was accepted without an earlier verified snapshot")
	}

	fs = newFakeFS()
	bus.values["ActiveState"] = "active"
	bus.values["MainPID"] = uint32(42)
	unit = &systemdUnit{name: "crux-anydoc-malformed.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err = unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	_, _ = unit.Report(context.Background())
	unit.MarkSnapshotVerified()
	delete(fs.files, cgroupFile("/crux.slice/test", "memory.max"))
	fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
	fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = nil
	bus.onStop = func() {
		for path := range fs.files {
			if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
				delete(fs.files, path)
			}
		}
	}
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	if _, _, _, reason := cleanup(unit); reason == "" {
		t.Fatal("cached accounting masked a malformed but present cgroup")
	}
}

func TestCleanupUsesVerifiedSnapshotWhenCgroupDisappearsDuringCPUUsage(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-cpu-enoent.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := unit.CPUUsage(context.Background()); err != nil {
		t.Fatal(err)
	}
	unit.MarkSnapshotVerified()

	fs.afterRead = func(path string) {
		if path != cgroupFile("/crux.slice/test", "cgroup.events") || fs.reads[path] != 3 {
			return
		}
		for cgroupPath := range fs.files {
			if strings.HasPrefix(cgroupPath, "/sys/fs/cgroup/crux.slice/test/") {
				delete(fs.files, cgroupPath)
			}
		}
	}
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"

	report, cpu, termination, reason := cleanup(unit)
	if reason != "" || report.ControlGroup != "/crux.slice/test" || cpu != 11*time.Microsecond || !termination.Absent {
		t.Fatalf("CPUUsage-ENOENT cleanup = report %#v cpu %s termination %#v reason %q", report, cpu, termination, reason)
	}
}

func TestCleanupUsesRefreshAccountingSnapshotWhenCgroupRemoved(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-refresh-absent.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	unit.MarkSnapshotVerified()

	fs.files[cgroupFile("/crux.slice/test", "memory.current")] = []byte("4096\n")
	fs.files[cgroupFile("/crux.slice/test", "memory.peak")] = []byte("8192\n")
	fs.files[cgroupFile("/crux.slice/test", "memory.events")] = []byte("low 0\nhigh 0\nmax 1\noom 0\noom_kill 0\n")
	fs.files[cgroupFile("/crux.slice/test", "cpu.stat")] = []byte("usage_usec 42\nnr_periods 2\nnr_throttled 1\nthrottled_usec 5\n")
	fs.files[cgroupFile("/crux.slice/test", "pids.events")] = []byte("max 1\n")
	fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = []byte("42\n")
	fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 1\n")

	usage, err := unit.RefreshAccounting(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if usage != 42*time.Microsecond {
		t.Fatalf("refresh cpu = %s, want 42µs", usage)
	}
	cached, cachedCPU, ok := unit.LastVerifiedSnapshot()
	if !ok || cachedCPU != 42*time.Microsecond {
		t.Fatalf("verified snapshot missing after refresh: ok=%v cpu=%s", ok, cachedCPU)
	}
	if cached.MemoryPeak != 8192 || cached.MemoryCurrent != 4096 {
		t.Fatalf("refresh snapshot memory = peak %d current %d", cached.MemoryPeak, cached.MemoryCurrent)
	}
	if cached.MemoryEvents["max"] != 1 || cached.CPUStats["usage_usec"] != 42 || cached.PIDsEvents["max"] != 1 {
		t.Fatalf("refresh snapshot lost accounting maps: %#v", cached)
	}

	for path := range fs.files {
		if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
			delete(fs.files, path)
		}
	}
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"

	report, cpu, termination, reason := cleanup(unit)
	if reason != "" {
		t.Fatalf("cleanup reason = %q, want success via refresh snapshot", reason)
	}
	if report.ControlGroup != "/crux.slice/test" || cpu != 42*time.Microsecond || !termination.Absent {
		t.Fatalf("refresh-absent cleanup = report %#v cpu %s termination %#v", report, cpu, termination)
	}
	if report.MemoryPeak != 8192 || report.MemoryEvents["max"] != 1 || report.CPUStats["usage_usec"] != 42 || report.PIDsEvents["max"] != 1 {
		t.Fatalf("cleanup lost refresh accounting evidence: %#v", report)
	}
}

func TestCleanupRejectsMalformedPresentAccountingAfterRefresh(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-refresh-malformed.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	unit.MarkSnapshotVerified()
	if _, err := unit.RefreshAccounting(context.Background()); err != nil {
		t.Fatal(err)
	}

	// Malformed-but-present: cgroup still exists, but accounting files are broken.
	// Cleanup must not reuse the verified snapshot for this class of failure.
	delete(fs.files, cgroupFile("/crux.slice/test", "memory.peak"))
	fs.files[cgroupFile("/crux.slice/test", "memory.events")] = []byte("not-a-map\n")
	fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
	fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = nil
	bus.onStop = func() {
		for path := range fs.files {
			if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
				delete(fs.files, path)
			}
		}
	}
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"

	_, _, _, reason := cleanup(unit)
	if reason != "terminal-accounting-memory-peak" {
		t.Fatalf("cleanup reason = %q, want terminal-accounting-memory-peak for malformed-present data", reason)
	}
}

// After MarkSnapshotVerified, a later Report may still be PID/runtime-attested
// while a required sandbox property has been mutated. That live report must
// not replace the fully verified snapshot (snapshotOK is sticky) and therefore
// must not become the reusable ENOENT accounting fallback.
func TestVerifiedSnapshotNotReplacedByLaterUnverifiedReport(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-snapshot-immutable.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !first.PrivateNetwork {
		t.Fatal("fixture must start with PrivateNetwork=true")
	}
	unit.MarkSnapshotVerified()

	// Mutate a required sandbox property. Report still succeeds with MainPID and
	// matching runtime digest (PID/runtime attestation only).
	bus.values["PrivateNetwork"] = false
	live, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if live.PrivateNetwork {
		t.Fatal("live Report did not observe PrivateNetwork mutation")
	}

	cached, _, ok := unit.LastVerifiedSnapshot()
	if !ok {
		t.Fatal("verified snapshot became unavailable after later Report")
	}
	if !cached.PrivateNetwork {
		t.Fatal("later unverified Report replaced the verified snapshot base")
	}

	// Accounting refresh must keep the verified sandbox identity and only
	// update accounting fields for the same cgroup.
	fs.files[cgroupFile("/crux.slice/test", "memory.current")] = []byte("4096\n")
	fs.files[cgroupFile("/crux.slice/test", "memory.peak")] = []byte("8192\n")
	fs.files[cgroupFile("/crux.slice/test", "cpu.stat")] = []byte("usage_usec 42\nnr_periods 2\nnr_throttled 1\nthrottled_usec 5\n")
	if _, err := unit.RefreshAccounting(context.Background()); err != nil {
		t.Fatal(err)
	}
	cached, cachedCPU, ok := unit.LastVerifiedSnapshot()
	if !ok || cachedCPU != 42*time.Microsecond {
		t.Fatalf("refresh lost verified snapshot: ok=%v cpu=%s", ok, cachedCPU)
	}
	if !cached.PrivateNetwork || cached.MemoryPeak != 8192 {
		t.Fatalf("refresh must keep verified identity and update accounting only: %#v", cached)
	}

	for path := range fs.files {
		if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
			delete(fs.files, path)
		}
	}
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"

	report, cpu, termination, reason := cleanup(unit)
	if reason != "" {
		t.Fatalf("cleanup reason = %q, want success via verified base", reason)
	}
	if !termination.Absent || cpu != 42*time.Microsecond {
		t.Fatalf("cleanup termination/cpu = %#v %s", termination, cpu)
	}
	if !report.PrivateNetwork {
		t.Fatal("ENOENT fallback reused a merely PID/runtime-attested mutated report")
	}
	if report.MemoryPeak != 8192 {
		t.Fatalf("ENOENT fallback lost refreshed accounting: peak=%d", report.MemoryPeak)
	}
}

func TestMountedRuntimeAttestationRejectsTreeTamperingAndProcErrors(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".complete"), nil, 0o444); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(root, 0o755) })
	fs := rootedProcFS{root: root}
	digest, err := mountedRuntimeDigest(fs, 42)
	if err != nil || len(digest) != 64 {
		t.Fatalf("digest = %q, %v", digest, err)
	}

	tests := []struct {
		name   string
		mutate func(string) error
	}{
		{"extra", func(root string) error {
			_ = os.Chmod(root, 0o755)
			err := os.WriteFile(filepath.Join(root, "extra"), []byte("x"), 0o444)
			_ = os.Chmod(root, 0o555)
			return err
		}},
		{"writable root", func(root string) error { return os.Chmod(root, 0o755) }},
		{"writable directory", func(root string) error {
			_ = os.Chmod(root, 0o755)
			path := filepath.Join(root, "dir")
			if err := os.Mkdir(path, 0o755); err != nil {
				return err
			}
			if err := os.Chmod(path, 0o777); err != nil {
				return err
			}
			return os.Chmod(root, 0o555)
		}},
		{"file mode", func(root string) error { return os.Chmod(filepath.Join(root, ".complete"), 0o644) }},
		{"file hash", func(root string) error {
			path := filepath.Join(root, ".complete")
			_ = os.Chmod(path, 0o644)
			err := os.WriteFile(path, []byte("changed"), 0o444)
			_ = os.Chmod(path, 0o444)
			return err
		}},
		{"symlink", func(root string) error {
			_ = os.Chmod(root, 0o755)
			err := os.Symlink(".complete", filepath.Join(root, "link"))
			_ = os.Chmod(root, 0o555)
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			copyRoot := t.TempDir()
			if err := os.WriteFile(filepath.Join(copyRoot, ".complete"), nil, 0o444); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(copyRoot, 0o555); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(copyRoot, 0o755) })
			if err := test.mutate(copyRoot); err != nil {
				t.Fatal(err)
			}
			got, err := mountedRuntimeDigest(rootedProcFS{root: copyRoot}, 42)
			if err == nil && got == digest {
				t.Fatal("tampered mounted runtime matched attested tree")
			}
		})
	}
	if _, err := mountedRuntimeDigest(rootedProcFS{root: filepath.Join(root, "missing")}, 42); err == nil {
		t.Fatal("proc lookup error accepted")
	}
}

type rootedProcFS struct{ root string }

func (f rootedProcFS) path(path string) string {
	prefix := filepath.Join("/proc", "42", "root", strings.TrimPrefix(runtimeTarget, "/"))
	rel := strings.TrimPrefix(path, prefix)
	return filepath.Join(f.root, strings.TrimPrefix(rel, "/"))
}
func (f rootedProcFS) Lstat(path string) (os.FileInfo, error) {
	if path == filepath.Join("/proc", "42", "root") {
		return fakeRuntimeInfo{name: "root", mode: os.ModeSymlink | 0o777}, nil
	}
	return os.Lstat(f.path(path))
}
func (f rootedProcFS) ReadDir(path string) ([]os.DirEntry, error) { return os.ReadDir(f.path(path)) }
func (f rootedProcFS) ReadFile(path string) ([]byte, error)       { return os.ReadFile(f.path(path)) }

func TestSystemdStopFallsBackToCgroupKillAndCleanup(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopErr = errors.New("denied")
	bus.killErr = errors.New("denied")
	fs := newFakeFS()
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}, tmp: "/run/anydoc/private"}
	if err := u.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if string(fs.writes[cgroupFile("/crux.slice/test", "cgroup.kill")]) != "1" {
		t.Fatal("cgroup.kill fallback not used")
	}
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	if err := u.WaitInactive(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := u.Cleanup(context.Background()); err != nil || !fs.removed["/run/anydoc/private"] || !bus.reset {
		t.Fatalf("cleanup err=%v removed=%v reset=%v", err, fs.removed, bus.reset)
	}
}

func TestRunFinishAcceptsOnlyProvenResetFailedUnitNoSuchUnit(t *testing.T) {
	const secret = "/private/reset-failed-unit-secret"
	for _, test := range []struct {
		name         string
		resetErr     error
		status       map[string]any
		termination  string
		removeErr    error
		wantClean    bool
		wantReason   string
		wantWorkload WorkloadOutcomeCode
	}{
		{name: "accepts exact no such unit value with empty cgroup", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{secret}}, wantClean: true},
		{name: "accepts exact no such unit pointer with absent cgroup", resetErr: &dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{secret}}, termination: "absent", wantClean: true},
		{name: "accepts exact no such unit wrapped", resetErr: fmt.Errorf("reset failed: %w", dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{secret}}), wantClean: true},
		{name: "rejects unknown object", resetErr: dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject", Body: []any{secret}}, wantReason: "unit-cleanup-reset-failed-unit-unknown-object"},
		{name: "rejects access denied", resetErr: &dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{secret}}, wantReason: "unit-cleanup-reset-failed-unit-access-denied"},
		{name: "rejects invalid args", resetErr: fmt.Errorf("reset failed: %w", dbus.Error{Name: "org.freedesktop.DBus.Error.InvalidArgs", Body: []any{secret}}), wantReason: "unit-cleanup-reset-failed-unit-invalid-args"},
		{name: "rejects other dbus", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.OtherFailure", Body: []any{secret}}, wantReason: "unit-cleanup-reset-failed-unit-dbus-other"},
		{name: "rejects unavailable", resetErr: errors.New(secret), wantReason: "unit-cleanup-reset-failed-unit-unavailable"},
		{name: "rejects failed result without independent proof", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, status: map[string]any{"Result": "exit-code"}, wantWorkload: WorkloadOutcomeCrash},
		{name: "rejects nonzero status without independent proof", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, status: map[string]any{"ExecMainStatus": int32(1)}, wantWorkload: WorkloadOutcomeCrash},
		{name: "rejects live status", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, status: map[string]any{"ActiveState": "active", "MainPID": uint32(42)}, wantReason: "wait-inactive"},
		{name: "rejects nonexclusive termination", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, termination: "nonexclusive", wantReason: "termination-evidence"},
		{name: "rejects mismatched termination", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, termination: "mismatch", wantReason: "termination-evidence"},
		{name: "rejects reset and private-temp failure", resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, removeErr: errors.New(secret), wantReason: "unit-cleanup-reset-failed-unit-no-such-unit"},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			bus.resetErr = test.resetErr
			fs := newFakeFS()
			fs.removeErr = test.removeErr
			u := &systemdUnit{name: "crux-anydoc-private.service", bus: bus, fs: fs, now: immediateClock{}, tmp: secret}
			active, err := u.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			u.spec = ServiceSpec{
				runtimeTreeDigest:       active.RuntimeTreeDigest,
				MemoryMax:               active.MemoryMax,
				MemorySwapMax:           active.MemorySwapMax,
				TasksMax:                active.TasksMax,
				CPUQuotaPercent:         active.CPUQuotaPercent,
				CPUQuotaPeriodUSec:      active.CPUQuotaPeriodUSec,
				RuntimeMax:              active.RuntimeMax,
				KillMode:                active.KillMode,
				ProtectSystem:           active.ProtectSystem,
				CPUAccounting:           active.CPUAccounting,
				NoNewPrivileges:         active.NoNewPrivileges,
				PrivateNetwork:          active.PrivateNetwork,
				PrivateTmp:              active.PrivateTmp,
				ProtectHome:             active.ProtectHome,
				ReadOnlyPaths:           active.ReadOnlyPaths,
				InaccessiblePaths:       active.InaccessiblePaths,
				BindReadOnlyPaths:       active.BindReadOnlyPaths,
				ReadWritePaths:          active.ReadWritePaths,
				RestrictAddressFamilies: active.RestrictAddressFamilies,
			}
			if !verify(context.Background(), &verifiedLifecycleSystemdUnit{systemdUnit: u}, u.spec) {
				t.Fatal("production verification lifecycle rejected fake unit")
			}
			bus.onStop = func() {
				bus.values["ActiveState"] = "inactive"
				bus.values["MainPID"] = uint32(0)
				bus.values["Result"] = "success"
				bus.values["ExecMainStatus"] = int32(0)
				for key, value := range test.status {
					bus.values[key] = value
				}
				fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
				fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = []byte{}
				switch test.termination {
				case "absent":
					delete(fs.files, cgroupFile("/crux.slice/test", "cgroup.events"))
					delete(fs.files, cgroupFile("/crux.slice/test", "cgroup.procs"))
				case "nonexclusive":
					fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 1\n")
				case "mismatch":
					u.reportMu.Lock()
					u.controlGroup = "/crux.slice/other"
					u.reportMu.Unlock()
				}
			}
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: t.TempDir() + "/already-closed.sock", Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			u.listener, u.resultListener = listener, listener
			u.socket, u.resultSocket = t.TempDir()+"/already-removed.sock", t.TempDir()+"/already-removed-result.sock"
			_ = listener.Close()
			staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
			if err != nil {
				t.Fatal(err)
			}
			_, write, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer write.Close()
			run := &Run{unit: u, write: write, staged: staged, stop: make(chan struct{}), finished: make(chan struct{}), started: time.Now()}
			finishErr := run.Finish(context.Background(), nil)
			terminal := run.TerminalReport()
			if terminal.Cleaned != test.wantClean {
				t.Fatalf("terminal cleaned = %t, want %t", terminal.Cleaned, test.wantClean)
			}
			wantWorkload := test.wantWorkload
			if wantWorkload == "" {
				wantWorkload = WorkloadOutcomeSuccess
			}
			if terminal.Workload.Code != wantWorkload || terminal.Cleanup.Accepted != test.wantClean {
				t.Fatalf("terminal proof = %#v, want workload=%q cleanup accepted=%t", terminal, wantWorkload, test.wantClean)
			}
			if test.wantClean {
				if finishErr != nil || terminal.Outcome != OutcomeSuccess {
					t.Fatalf("Finish() = %v, terminal = %#v", finishErr, terminal)
				}
				if !fs.removed[secret] || !bus.reset {
					t.Fatalf("cleanup did not attempt private-temp removal and reset: removed=%v reset=%t", fs.removed, bus.reset)
				}
				return
			}
			got := safeExecutionFailure(finishErr, terminal)
			if (test.wantReason != "" && !strings.Contains(got, "reason="+test.wantReason)) || strings.Contains(got, secret) || strings.Contains(got, "NoSuchUnit") || strings.Contains(got, "OtherFailure") || strings.Contains(got, "AccessDenied") || strings.Contains(got, "UnknownObject") || strings.Contains(got, "InvalidArgs") {
				t.Fatalf("safe execution failure = %q", got)
			}
			if !fs.removed[secret] || !bus.reset {
				t.Fatalf("cleanup did not attempt private-temp removal and reset: removed=%v reset=%t", fs.removed, bus.reset)
			}
		})
	}
}

func TestSystemdAuthorizationRejectsForeignPeerAndUnlinksSocket(t *testing.T) {
	path := t.TempDir() + "/auth.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	bus := newFakeSystemBus()
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, listener: listener, socket: path, peers: fakePeer{pid: 43}}
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	go func() {
		done <- u.AuthorizeCapability(ctx, Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), RequestDigest: strings.Repeat("b", 64), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()})
	}()
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
	if err := <-done; err == nil {
		t.Fatal("foreign cgroup peer was authorized")
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("socket retained: %v", err)
	}
}

func TestSystemdAuthorizationSkipsForeignPeerBeforeAuthorizingWorker(t *testing.T) {
	path := t.TempDir() + "/auth.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	peers := fakePeer{}
	credentialsCalls := 0
	peers.credentials = func(*net.UnixConn) (int, uint32, error) {
		credentialsCalls++
		if credentialsCalls == 1 {
			return 43, 1000, nil
		}
		return 42, 1000, nil
	}
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: newFakeSystemBus(), fs: newFakeFS(), now: immediateClock{}, listener: listener, socket: path, peers: peers}
	request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() { done <- u.AuthorizeCapability(ctx, request) }()

	foreign, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	_ = foreign.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := foreign.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("foreign peer read = %v, want no authorization request", err)
	}
	_ = foreign.Close()

	worker, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeRequest(worker)
	if err != nil {
		t.Fatal(err)
	}
	_ = worker.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got != request {
		t.Fatalf("authorized request = %#v, want %#v", got, request)
	}
	if credentialsCalls != 2 {
		t.Fatalf("peer credential checks = %d, want foreign and worker checks", credentialsCalls)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("socket retained: %v", err)
	}
}

func TestTask1LifecycleWitnessOrdersACKAndCopiesSnapshot(t *testing.T) {
	path := t.TempDir() + "/result.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: newFakeSystemBus(), fs: newFakeFS(), now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}}
	first, err := u.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	u.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := u.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	u.MarkSnapshotVerified()
	witnessPresentAtACK := make(chan bool, 1)
	u.writeResultACK = func(conn *net.UnixConn) error {
		_, ok := u.lastLifecycleWitness()
		witnessPresentAtACK <- ok
		_, err := conn.Write([]byte("ACK\n"))
		return err
	}
	done := make(chan struct {
		result Result
		err    error
	}, 1)
	request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
	go func() {
		result, receiveErr := u.ReceiveResult(context.Background(), request)
		done <- struct {
			result Result
			err    error
		}{result, receiveErr}
	}()
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	if err := EncodeResult(conn, validWireResult(request)); err != nil {
		t.Fatal(err)
	}
	ack := make([]byte, 4)
	if _, err := io.ReadFull(conn, ack); err != nil || string(ack) != "ACK\n" {
		t.Fatalf("ack = %q, %v", ack, err)
	}
	_ = conn.Close()
	got := <-done
	if got.err != nil || !bytes.Equal(got.result.Payload, validWireResult(request).Payload) {
		t.Fatalf("result = %#v, %v", got.result, got.err)
	}
	if <-witnessPresentAtACK {
		t.Fatal("witness minted before ACK write")
	}
	witness, ok := u.lastLifecycleWitness()
	if !ok || witness.unit != u.name || witness.cgroup != first.ControlGroup || witness.pid != first.MainPID || witness.runtimeDigest != first.RuntimeTreeDigest || witness.requestDigest != request.RequestDigest || witness.nonce != request.Nonce {
		t.Fatalf("lifecycle witness = %#v, %v", witness, ok)
	}
	if witness.snapshot.MemoryEvents["oom"] != 0 || witness.snapshot.MemoryEvents["oom_kill"] != 0 || witness.snapshot.PIDsEvents["max"] != 0 || !reflect.DeepEqual(witness.snapshot.ControlGroupMembers, first.ControlGroupMembers) {
		t.Fatalf("lifecycle witness snapshot = %#v", witness.snapshot)
	}
	witness.snapshot.MemoryEvents["oom_kill"] = 1
	witness.snapshot.PIDsEvents["max"] = 1
	witness.snapshot.ControlGroupMembers[0] = 0
	witnessAgain, ok := u.lastLifecycleWitness()
	if !ok || witnessAgain.snapshot.MemoryEvents["oom_kill"] != 0 || witnessAgain.snapshot.PIDsEvents["max"] != 0 || witnessAgain.snapshot.ControlGroupMembers[0] != first.ControlGroupMembers[0] {
		t.Fatalf("lifecycle witness was mutable: %#v", witnessAgain.snapshot)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("socket retained: %v", err)
	}
}

func TestTask1LifecycleWitnessRejectsIdentityMismatch(t *testing.T) {
	path := t.TempDir() + "/result.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: newFakeSystemBus(), fs: newFakeFS(), now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}}
	expected := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
	expected.RequestDigest = requestDigest(expected.Version, expected.Nonce, expected.Format, expected.SourceSHA256, expected.SourceBytes, expected.Limits)
	done := make(chan error, 1)
	go func() { _, receiveErr := u.ReceiveResult(context.Background(), expected); done <- receiveErr }()
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	mismatched := expected
	mismatched.Limits.ResultBytes--
	mismatched.RequestDigest = requestDigest(mismatched.Version, mismatched.Nonce, mismatched.Format, mismatched.SourceSHA256, mismatched.SourceBytes, mismatched.Limits)
	if err := EncodeResult(conn, validWireResult(mismatched)); err != nil {
		t.Fatal(err)
	}
	ack := make([]byte, 4)
	if _, err := io.ReadFull(conn, ack); err == nil {
		t.Fatalf("mismatched result was acknowledged: %q", ack)
	}
	_ = conn.Close()
	if err := <-done; err == nil {
		t.Fatal("mismatched result accepted")
	}
}

func TestTask1LifecycleWitnessRejectsEarlierFailures(t *testing.T) {
	for _, test := range []struct {
		name  string
		setup func(*systemdUnit, *fakeFS, SandboxReport)
		stage string
	}{
		{
			name: "refresh",
			setup: func(_ *systemdUnit, fs *fakeFS, report SandboxReport) {
				path := cgroupFile(report.ControlGroup, "memory.current")
				// ReceiveResult reads this once for peer identity and once more
				// during RefreshAccounting. Fail only the latter.
				fs.failReadAt[path] = fs.reads[path] + 2
			},
			stage: "accounting-refresh",
		},
		{
			name: "ack",
			setup: func(unit *systemdUnit, _ *fakeFS, _ SandboxReport) {
				unit.writeResultACK = func(*net.UnixConn) error { return errors.New("ACK failed") }
			},
			stage: "ack-write",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := t.TempDir() + "/result.sock"
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			fs := newFakeFS()
			unit := &systemdUnit{name: "crux-anydoc-task1.service", bus: newFakeSystemBus(), fs: fs, now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}}
			first, err := unit.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
			if _, err := unit.Report(context.Background()); err != nil {
				t.Fatal(err)
			}
			unit.MarkSnapshotVerified()
			test.setup(unit, fs, first)
			request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
			request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
			done := make(chan error, 1)
			go func() { _, receiveErr := unit.ReceiveResult(context.Background(), request); done <- receiveErr }()
			conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			// A host-side rejection may close after reading the complete frame, so
			// the client can observe a write error while the receiver still records
			// the intended accounting/ACK failure.
			_ = EncodeResult(conn, validWireResult(request))
			_ = conn.Close()
			err = <-done
			var validation *ResultValidationError
			if !errors.As(err, &validation) || validation.Stage != test.stage {
				t.Fatalf("ReceiveResult() = %T %v, want %s validation", err, err, test.stage)
			}
			if _, ok := unit.lastLifecycleWitness(); ok {
				t.Fatal("failure minted a lifecycle witness")
			}
		})
	}
}

func TestTask1LifecycleWitnessRejectsRefreshedResourceLimits(t *testing.T) {
	for _, test := range []struct {
		name         string
		memoryEvents []byte
		pidsEvents   []byte
	}{
		{name: "memory oom", memoryEvents: []byte("low 0\nhigh 0\nmax 0\noom 1\noom_kill 0\n")},
		{name: "memory oom kill", memoryEvents: []byte("low 0\nhigh 0\nmax 0\noom 0\noom_kill 1\n")},
		{name: "pids max", pidsEvents: []byte("max 1\n")},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := t.TempDir() + "/result.sock"
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			fs := newFakeFS()
			unit := &systemdUnit{name: "crux-anydoc-task1.service", bus: newFakeSystemBus(), fs: fs, now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}}
			first, err := unit.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
			if _, err := unit.Report(context.Background()); err != nil {
				t.Fatal(err)
			}
			unit.MarkSnapshotVerified()
			if test.memoryEvents != nil {
				fs.files[cgroupFile(first.ControlGroup, "memory.events")] = test.memoryEvents
			}
			if test.pidsEvents != nil {
				fs.files[cgroupFile(first.ControlGroup, "pids.events")] = test.pidsEvents
			}
			ackWritten := false
			unit.writeResultACK = func(*net.UnixConn) error {
				ackWritten = true
				return nil
			}
			request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
			request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
			done := make(chan error, 1)
			go func() { _, receiveErr := unit.ReceiveResult(context.Background(), request); done <- receiveErr }()
			conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			if err := EncodeResult(conn, validWireResult(request)); err != nil {
				t.Fatal(err)
			}
			ack := make([]byte, 4)
			if _, err := io.ReadFull(conn, ack); err == nil {
				t.Fatalf("resource-limited result was acknowledged: %q", ack)
			}
			_ = conn.Close()
			err = <-done
			var validation *ResultValidationError
			if !errors.As(err, &validation) || validation.Stage != "accounting-refresh" || validation.ReasonCode != "unavailable" {
				t.Fatalf("ReceiveResult() = %T %v, want unavailable accounting-refresh validation", err, err)
			}
			if ackWritten {
				t.Fatal("resource-limited result wrote an ACK")
			}
			if _, ok := unit.lastLifecycleWitness(); ok {
				t.Fatal("resource-limited result minted a lifecycle witness")
			}
		})
	}
}

func TestSystemdResultReportsTerminalWorkerCrash(t *testing.T) {
	path := t.TempDir() + "/result.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	bus := newFakeSystemBus()
	bus.values["ActiveState"] = "failed"
	bus.values["MainPID"] = uint32(0)
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}}
	request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)

	_, err = u.ReceiveResult(context.Background(), request)
	var supervisorErr *SupervisorError
	if !errors.As(err, &supervisorErr) || supervisorErr.Code != ErrWorkerCrash {
		t.Fatalf("terminal result error = %T %v, want typed %q", err, err, ErrWorkerCrash)
	}
}

func TestSystemdResultReceiveFailuresUseContainmentErrors(t *testing.T) {
	request := Request{}
	for name, unit := range map[string]*systemdUnit{
		"missing listener": {peers: fakePeer{pid: 42}},
		"missing peers": func() *systemdUnit {
			path := t.TempDir() + "/result.sock"
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_ = listener.Close()
				_ = os.Remove(path)
			})
			return &systemdUnit{resultListener: listener, resultSocket: path}
		}(),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := unit.ReceiveResult(context.Background(), request)
			var containmentErr *ContainmentError
			if !errors.As(err, &containmentErr) || containmentErr.Stage != "result-receive" || containmentErr.ReasonCode != "unavailable" {
				t.Fatalf("result error = %T %v", err, err)
			}
			var validationErr *ResultValidationError
			if errors.As(err, &validationErr) {
				t.Fatalf("result receive failure used validation error: %#v", validationErr)
			}
		})
	}

	path := t.TempDir() + "/result.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = (&systemdUnit{bus: newFakeSystemBus(), fs: newFakeFS(), now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}}).ReceiveResult(context.Background(), request)
	var containmentErr *ContainmentError
	if !errors.As(err, &containmentErr) || containmentErr.Stage != "result-receive" || containmentErr.ReasonCode != "io" {
		t.Fatalf("accept error = %T %v", err, err)
	}
}

func TestTask1LifecycleWitnessRejectsDuplicateReceiver(t *testing.T) {
	path := t.TempDir() + "/result.sock"
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: newFakeSystemBus(), fs: newFakeFS(), now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}}
	request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := make(chan error, 1)
	go func() { _, receiveErr := u.ReceiveResult(ctx, request); first <- receiveErr }()
	for {
		u.resultMu.Lock()
		claimed := u.resultClaimed
		u.resultMu.Unlock()
		if claimed {
			break
		}
		time.Sleep(time.Millisecond)
	}

	_, err = u.ReceiveResult(context.Background(), request)
	var supervisorErr *SupervisorError
	if !errors.As(err, &supervisorErr) || supervisorErr.Code != ErrReplay {
		t.Fatalf("second receiver error = %T %v, want typed %q", err, err, ErrReplay)
	}
	cancel()
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatalf("first receiver error = %v, want context cancellation", err)
	}
}

func TestTask3SealedProbeLifecycleOutcome(t *testing.T) {
	for _, test := range []struct {
		name        string
		probeCase   string
		mutate      func(*systemdUnit, *fakeFS, *sealedProbeObservation)
		wantAck     bool
		wantWitness bool
	}{
		{name: "contained", wantAck: true, wantWitness: true},
		{name: "pids positive evidence", probeCase: "pids", mutate: func(_ *systemdUnit, fs *fakeFS, _ *sealedProbeObservation) {
			fs.files[cgroupFile("/crux.slice/test", "pids.events")] = []byte("max 1\n")
		}, wantAck: true, wantWitness: true},
		{name: "pids cumulative evidence", probeCase: "pids", mutate: func(_ *systemdUnit, fs *fakeFS, _ *sealedProbeObservation) {
			fs.files[cgroupFile("/crux.slice/test", "pids.events")] = []byte("max 2\n")
		}, wantAck: true, wantWitness: true},
		{name: "case mismatch", mutate: func(_ *systemdUnit, _ *fakeFS, o *sealedProbeObservation) { o.Case = "other" }},
		{name: "invocation mismatch", mutate: func(_ *systemdUnit, _ *fakeFS, o *sealedProbeObservation) { o.Invocation = strings.Repeat("b", 64) }},
		{name: "invalid observation", mutate: func(_ *systemdUnit, _ *fakeFS, o *sealedProbeObservation) { o.Checks = nil }},
		{name: "peer authentication", mutate: func(u *systemdUnit, _ *fakeFS, _ *sealedProbeObservation) { u.peers = fakePeer{pid: 41} }},
		{name: "ack failure", mutate: func(u *systemdUnit, _ *fakeFS, _ *sealedProbeObservation) {
			u.writeResultACK = func(*net.UnixConn) error { return errors.New("ack") }
		}},
		{name: "oom contradiction", mutate: func(_ *systemdUnit, fs *fakeFS, _ *sealedProbeObservation) {
			fs.files[cgroupFile("/crux.slice/test", "memory.events")] = []byte("low 0\nhigh 0\nmax 0\noom 1\noom_kill 0\n")
		}},
		{name: "pids contradiction", mutate: func(_ *systemdUnit, fs *fakeFS, _ *sealedProbeObservation) {
			fs.files[cgroupFile("/crux.slice/test", "pids.events")] = []byte("max 1\n")
		}},
		{name: "snapshot mismatch", mutate: func(u *systemdUnit, _ *fakeFS, _ *sealedProbeObservation) { u.snapshot.RuntimeTreeDigest = "mismatch" }},
		{name: "sealed executable mismatch", mutate: func(u *systemdUnit, _ *fakeFS, _ *sealedProbeObservation) {
			u.verifyProbe = func(context.Context, *containmentProbe) error { return errors.New("seal") }
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := t.TempDir() + "/probe.sock"
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			fs := newFakeFS()
			probeCase := test.probeCase
			if probeCase == "" {
				probeCase = "network"
			}
			probe := &containmentProbe{hostExecutable: "/run/probe", executableSHA: strings.Repeat("a", 64), action: probeCase, caseID: probeCase, resultPath: probeObservationTarget, hostResultPath: "/run/private/observation.json"}
			u := &systemdUnit{name: "crux-anydoc-task3.service", bus: newFakeSystemBus(), fs: fs, now: immediateClock{}, resultListener: listener, resultSocket: path, peers: fakePeer{pid: 42}, spec: ServiceSpec{probe: probe}, verifyProbe: func(context.Context, *containmentProbe) error { return nil }}
			first, err := u.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			u.spec.runtimeTreeDigest = first.RuntimeTreeDigest
			if _, err := u.Report(context.Background()); err != nil {
				t.Fatal(err)
			}
			u.MarkSnapshotVerified()
			request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
			request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
			u.authorized, u.authorizedRequest = true, request
			checks, ok := sealedProbeObservationChecks(probe.caseID)
			if !ok {
				t.Fatal("missing sealed probe check contract")
			}
			observationChecks := make(map[string]bool, len(checks))
			for check := range checks {
				observationChecks[check] = true
			}
			observation := sealedProbeObservation{Schema: sealedProbeObservationSchema, Version: sealedProbeObservationVersion, Case: probe.caseID, Invocation: request.RequestDigest, Checks: observationChecks}
			if test.mutate != nil {
				test.mutate(u, fs, &observation)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			run := &Run{unit: u, nonce: request.Nonce, digest: request.RequestDigest, sourceSHA: request.SourceSHA256, sourceBytes: request.SourceBytes, format: request.Format, limits: request.Limits}
			done := make(chan error, 1)
			go func() { done <- run.receiveSealedProbeObservation(ctx, probe) }()
			if test.name != "sealed executable mismatch" {
				conn, dialErr := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
				if dialErr == nil {
					_ = writeFrame(conn, observation)
					ack := make([]byte, 4)
					_, readErr := io.ReadFull(conn, ack)
					if (readErr == nil && string(ack) == "ACK\n") != test.wantAck {
						t.Fatalf("ACK = %q, %v", ack, readErr)
					}
					_ = conn.Close()
				}
			}
			err = <-done
			_, witnessed := u.lastLifecycleWitness()
			if (err == nil) != test.wantWitness || witnessed != test.wantWitness {
				t.Fatalf("receiveSealedProbeObservation() = %v, witness=%v", err, witnessed)
			}
			run.mu.Lock()
			probeObserved := run.sealedProbeObserved
			run.mu.Unlock()
			if probeObserved != test.wantWitness {
				t.Fatalf("sealed probe outcome evidence = %v, want %v", probeObserved, test.wantWitness)
			}
			if witnessed && u.lifecycleWitness.kind != lifecycleWitnessProbe {
				t.Fatalf("witness kind = %d", u.lifecycleWitness.kind)
			}
			if witnessed {
				replayErr := run.receiveSealedProbeObservation(context.Background(), probe)
				var replay *SupervisorError
				if !errors.As(replayErr, &replay) || replay.Code != ErrReplay {
					t.Fatalf("replay = %T %v, want typed %q", replayErr, replayErr, ErrReplay)
				}
			}
		})
	}
}

func TestTask3ProbeWitnessCleanupEligibility(t *testing.T) {
	const pinned = "/crux.slice/test"
	termination := TerminationEvidence{ControlGroup: pinned, Empty: true}
	statusErr := &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}
	base := lifecycleWitness{kind: lifecycleWitnessProbe, probeCase: "pids", cgroup: pinned, pid: 42, requestDigest: strings.Repeat("a", 64), nonce: strings.Repeat("b", 32), runtimeDigest: "digest"}
	snapshot := SandboxReport{ControlGroup: pinned, MainPID: 42, RuntimeTreeDigest: "digest", PIDsEvents: map[string]int64{"max": 1}}

	if reason := validateRuntimeTargetMissing(pinned, snapshot, base, true, termination, nil, TerminalStatus{}, statusErr, false); reason != "" {
		t.Fatalf("runtime teardown probe witness reason = %q", reason)
	}
	if reason := validateUnitPropertiesGone(pinned, snapshot, terminalSuccessProof{}, false, base, true, termination, nil, TerminalStatus{}, statusErr); reason != "" {
		t.Fatalf("unit-gone probe witness reason = %q", reason)
	}

	for _, test := range []struct {
		name   string
		mutate func(*lifecycleWitness, *SandboxReport)
	}{
		{name: "result kind carries probe case", mutate: func(w *lifecycleWitness, _ *SandboxReport) { w.kind = lifecycleWitnessResult }},
		{name: "unknown probe case", mutate: func(w *lifecycleWitness, _ *SandboxReport) { w.probeCase = "other" }},
		{name: "identity cgroup mismatch", mutate: func(w *lifecycleWitness, _ *SandboxReport) { w.cgroup = "/crux.slice/other" }},
		{name: "identity pid mismatch", mutate: func(_ *lifecycleWitness, s *SandboxReport) { s.MainPID = 43 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			witness, candidate := base, cloneSandboxReport(snapshot)
			test.mutate(&witness, &candidate)
			if reason := validateRuntimeTargetMissing(pinned, candidate, witness, true, termination, nil, TerminalStatus{}, statusErr, false); reason == "" {
				t.Fatal("runtime teardown accepted mismatched probe witness")
			}
			if reason := validateUnitPropertiesGone(pinned, candidate, terminalSuccessProof{}, false, witness, true, termination, nil, TerminalStatus{}, statusErr); reason == "" {
				t.Fatal("unit-gone accepted mismatched probe witness")
			}
		})
	}
}

type fakePeer struct {
	pid         int
	err         error
	credentials func(*net.UnixConn) (int, uint32, error)
}

func (p fakePeer) Credentials(conn *net.UnixConn) (int, uint32, error) {
	if p.credentials != nil {
		return p.credentials(conn)
	}
	return p.pid, 1000, p.err
}

func TestSystemdRejectsUnsafePaths(t *testing.T) {
	for _, path := range []string{"", "/", "relative", "/run/../etc"} {
		if validAbsolutePath(path) {
			t.Fatalf("accepted %q", path)
		}
	}
	if validCgroup("/crux/../evil") || validCgroup("relative") {
		t.Fatal("accepted unsafe cgroup")
	}
	spec, _ := newTestServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
	spec.ReadWritePaths = []string{"/run/../private"}
	if validBackendSpec(spec) {
		t.Fatal("accepted unsafe backend spec")
	}
}

func TestSystemdPropertyWireTypesRoundTrip(t *testing.T) {
	spec, _ := newTestServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
	props := propertiesByName(systemdProperties(spec))
	for _, name := range []string{"CapabilityBoundingSet", "AmbientCapabilities", "CPUQuotaPeriodUSec"} {
		if dbus.SignatureOf(props[name]).String() != "t" {
			t.Fatalf("%s signature %s", name, dbus.SignatureOf(props[name]))
		}
	}
	if dbus.SignatureOf(props["RestrictAddressFamilies"]).String() != "(bas)" {
		t.Fatalf("RAF signature %s", dbus.SignatureOf(props["RestrictAddressFamilies"]))
	}
	if dbus.SignatureOf(props["BindReadOnlyPaths"]).String() != "a(ssbt)" {
		t.Fatalf("BindReadOnlyPaths signature %s", dbus.SignatureOf(props["BindReadOnlyPaths"]))
	}
	if dbus.SignatureOf(props["ProtectHome"]).String() != "s" || props["ProtectHome"] != "yes" {
		t.Fatalf("ProtectHome wire value %#v", props["ProtectHome"])
	}
	wantBinds := []string{"/run/runtime:" + runtimeTarget, "/run/input:" + stagedSourceTarget}
	if binds, ok := bindReadOnlyPathsValue(props["BindReadOnlyPaths"]); !ok || !same(binds, wantBinds) {
		t.Fatalf("BindReadOnlyPaths did not decode: %#v", props["BindReadOnlyPaths"])
	}
	generic := []any{[]any{"/a", "/b", false, uint64(0)}}
	if binds, ok := bindReadOnlyPathsValue(generic); !ok || !same(binds, []string{"/a:/b"}) {
		t.Fatalf("generic tuples did not decode: %#v", generic)
	}
	type systemdBindTuple struct {
		Source        string
		Destination   string
		IgnoreMissing bool
		MountFlags    uint64
	}
	concrete := []systemdBindTuple{{Source: "/a", Destination: "/b", IgnoreMissing: false, MountFlags: 0}}
	if binds, ok := bindReadOnlyPathsValue(concrete); !ok || !same(binds, []string{"/a:/b"}) {
		t.Fatalf("concrete tuples did not decode: %#v", concrete)
	}
	for _, malformed := range []any{
		[]any{[]any{"/a", "/b", true, uint64(0)}},
		[]any{[]any{"/a", "/b", false, uint64(1)}},
		[]any{[]any{"/a", "/b", false}},
		[]any{[]any{"/a", "/b", false, int(0)}},
	} {
		if _, ok := bindReadOnlyPathsValue(malformed); ok {
			t.Fatalf("malformed bind tuple accepted: %#v", malformed)
		}
	}
	raw := []any{true, []string{"AF_UNIX"}}
	allow, families, ok := restrictAddressFamiliesValue(raw)
	if !ok || !allow || !same(families, []string{"AF_UNIX"}) {
		t.Fatal("RAF did not decode")
	}
	if _, _, ok := restrictAddressFamiliesValue([]any{true, "AF_UNIX"}); ok {
		t.Fatal("RAF type mismatch accepted")
	}
}

func TestSystemdReportAndVerifyBindPaths(t *testing.T) {
	spec, err := newTestServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	spec.probe = &containmentProbe{hostExecutable: "/run/probe", executableSHA: strings.Repeat("a", 64), action: "network", caseID: "network", resultPath: probeObservationTarget, hostResultPath: "/run/private/observation.json"}

	for _, test := range []struct {
		name      string
		bindPaths any
		present   bool
		want      bool
	}{
		{name: "exact", bindPaths: bindReadOnlyPathProperties(bindPathsForSpec(spec)), present: true, want: true},
		{name: "missing", want: false},
		{name: "extra", bindPaths: append(bindReadOnlyPathProperties(bindPathsForSpec(spec)), bindReadOnlyPath{Source: "/run/extra", Destination: "/run/extra"}), present: true, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			if test.present {
				bus.values["BindPaths"] = test.bindPaths
			}
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, spec: spec}
			report, err := unit.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if test.want != same(report.BindPaths, bindPathsForSpec(spec)) {
				t.Fatalf("report BindPaths = %#v", report.BindPaths)
			}
			verification := &verifiedProbeFakeUnit{fakeUnit: fakeUnit{rep: harnessReport(spec)}}
			verification.rep.BindPaths = report.BindPaths
			if got := verify(context.Background(), verification, spec); got != test.want {
				t.Fatalf("verify = %t, want %t", got, test.want)
			}
		})
	}

	ordinarySpec, err := newTestServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	ordinaryBus := newFakeSystemBus()
	if err := ordinaryBus.StartTransientUnit(context.Background(), "crux-anydoc-test.service", systemdProperties(ordinarySpec)); err != nil {
		t.Fatal(err)
	}
	ordinary := &systemdUnit{name: "crux-anydoc-test.service", bus: ordinaryBus, fs: newFakeFS(), now: immediateClock{}, spec: ordinarySpec}
	report, err := ordinary.Report(context.Background())
	if err != nil || !same(report.BindPaths, bindPathsForSpec(ordinarySpec)) {
		t.Fatalf("ordinary BindPaths = %#v, err = %v", report.BindPaths, err)
	}
}

func TestPostStartReportDiagnosticsPreserveSanitizedGodbusClass(t *testing.T) {
	private := "/private/post-start-report-secret"
	for _, test := range []struct {
		name  string
		stage terminalStatusUnavailableStage
		err   error
		want  string
	}{
		{name: "get unit gone value", stage: terminalStatusGetUnit, err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}, want: "report-get-unit-gone"},
		{name: "get unit gone pointer", stage: terminalStatusGetUnit, err: &dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}, want: "report-get-unit-gone"},
		{name: "get unit gone wrapped value", stage: terminalStatusGetUnit, err: fmt.Errorf("wrapped: %w", dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}), want: "report-get-unit-gone"},
		{name: "get unit gone wrapped pointer", stage: terminalStatusGetUnit, err: fmt.Errorf("wrapped: %w", &dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}), want: "report-get-unit-gone"},
		{name: "get unit unrecognized value", stage: terminalStatusGetUnit, err: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, want: "report-get-unit-unrecognized-dbus"},
		{name: "get unit unrecognized pointer", stage: terminalStatusGetUnit, err: &dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, want: "report-get-unit-unrecognized-dbus"},
		{name: "get unit unrecognized wrapped value", stage: terminalStatusGetUnit, err: fmt.Errorf("wrapped: %w", dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}), want: "report-get-unit-unrecognized-dbus"},
		{name: "get unit unrecognized wrapped pointer", stage: terminalStatusGetUnit, err: fmt.Errorf("wrapped: %w", &dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}), want: "report-get-unit-unrecognized-dbus"},
		{name: "get unit transport", stage: terminalStatusGetUnit, err: errors.New(private), want: "report-get-unit-unavailable"},
		{name: "unit properties gone", stage: terminalStatusUnitProperties, err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}, want: "report-unit-properties-gone"},
		{name: "unit properties unrecognized", stage: terminalStatusUnitProperties, err: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, want: "report-unit-properties-unrecognized-dbus"},
		{name: "unit properties transport", stage: terminalStatusUnitProperties, err: errors.New(private), want: "report-unit-properties-unavailable"},
		{name: "service properties gone", stage: terminalStatusServiceProperties, err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}, want: "report-service-properties-gone"},
		{name: "service properties unrecognized", stage: terminalStatusServiceProperties, err: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, want: "report-service-properties-unrecognized-dbus"},
		{name: "service properties transport", stage: terminalStatusServiceProperties, err: errors.New(private), want: "report-service-properties-unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := []*dbus.Call{{Err: test.err}}
			switch test.stage {
			case terminalStatusUnitProperties:
				calls = append([]*dbus.Call{{Body: []any{dbus.ObjectPath("/private/unit/path")}}}, calls...)
			case terminalStatusServiceProperties:
				calls = append([]*dbus.Call{
					{Body: []any{dbus.ObjectPath("/private/unit/path")}},
					{Body: []any{map[string]dbus.Variant{}}},
				}, calls...)
			}
			object := &fakeDBusObject{calls: calls}
			bus := &dbusHelperSystemBus{fakeSystemBus: newFakeSystemBus(), unitProperties: func(context.Context, string) (map[string]any, error) {
				return dbusUnitProperties(context.Background(), object, func(dbus.ObjectPath) dbus.BusObject { return object }, "crux-anydoc-test.service")
			}}
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}}
			_, err := unit.Report(context.Background())
			if len(object.calls) != 0 {
				t.Fatalf("Report() stopped before %s stage; %d fake calls remain", test.stage, len(object.calls))
			}
			diagnostic := startDiagnostic("post-start-report", err)
			if diagnostic.ReasonCode != test.want || strings.Contains(diagnostic.Error(), "private") || strings.Contains(diagnostic.Error(), "/") {
				t.Fatalf("post-start report diagnostic = %q, want reason %q", diagnostic.Error(), test.want)
			}
		})
	}

	if got := postStartReportReason(newReportValidationError(reportValidationSandboxProperties)); got != "report-sandbox-properties" {
		t.Fatalf("validation reason = %q", got)
	}
}

type fakeSystemBus struct {
	fdOK                       bool
	name                       string
	properties                 []DBusProperty
	values                     map[string]any
	startErr, stopErr, killErr error
	propErr                    error
	propGoneOnce               bool
	propErrAfterStop           bool
	// propGoneOnceAfterStop returns a typed properties-gone error on the first
	// UnitProperties call after StopUnit, then serves values again so terminal
	// proof can be asserted independently of stop confirmation.
	propGoneOnceAfterStop bool
	propGoneConsumed      bool
	propErrAfterGoneOnce  error
	// postStopProperties provides deterministic status observations after the
	// StopUnit GetUnit-gone response. It prevents WaitInactive tests from
	// accidentally polling a synthetic active status forever.
	postStopProperties     []fakeSystemBusProperties
	postStopPropertiesNext int
	// propGoneAfterStop confirms a successful terminal status once, then
	// simulates systemd unloading the transient unit before cleanup can poll.
	propGoneAfterStop               bool
	propertiesAfterStop             int
	valuesAfterFirstStopProperties  map[string]any
	propErrAfterFirstStopProperties error
	stopped                         bool
	stopDBusErrorName               string
	resetErr                        error
	reset                           bool
	onStop                          func()
}

type fakeSystemBusProperties struct {
	values map[string]any
	err    error
}

// verifiedLifecycleSystemdUnit lets this lifecycle test exercise verify's
// production snapshot-minting path without coupling it to host /proc state.
type verifiedLifecycleSystemdUnit struct{ *systemdUnit }

func (*verifiedLifecycleSystemdUnit) VerifyAttestedNode(context.Context, assets.AttestedNode) error {
	return nil
}

type verifiedProbeFakeUnit struct{ fakeUnit }

func (*verifiedProbeFakeUnit) VerifyAttestedProbe(context.Context, *containmentProbe) error {
	return nil
}

func newFakeSystemBus() *fakeSystemBus {
	return &fakeSystemBus{fdOK: true, values: map[string]any{"ActiveState": "active", "Result": "success", "MainPID": uint32(42), "ExecMainStatus": int32(0), "UID": uint32(1000), "DynamicUser": true, "PrivateUsers": true, "ProtectProc": "invisible", "ProcSubset": "pid", "ControlGroup": "/crux.slice/test", "RuntimeMaxUSec": uint64(RuntimeCeiling / time.Microsecond), "KillMode": "control-group", "ProtectSystem": "strict", "CPUAccounting": true, "NoNewPrivileges": true, "PrivateNetwork": true, "PrivateTmp": true, "ProtectHome": "yes", "CapabilityBoundingSet": uint64(0), "AmbientCapabilities": uint64(0), "ReadOnlyPaths": []string{"/run/anydoc/runtime"}, "BindReadOnlyPaths": []any{[]any{"/run/anydoc/input/source", stagedSourceTarget, false, uint64(0)}}, "ReadWritePaths": []string{"/run/anydoc/private"}, "RestrictAddressFamilies": restrictAddressFamilies{Allow: true, Families: []string{"AF_UNIX"}}}}
}
func (b *fakeSystemBus) SupportsUnixFDs() bool { return b.fdOK }
func (b *fakeSystemBus) StartTransientUnit(_ context.Context, name string, props []DBusProperty) error {
	b.name, b.properties = name, props
	values := propertiesByName(props)
	b.values["ReadOnlyPaths"] = values["ReadOnlyPaths"]
	b.values["InaccessiblePaths"] = values["InaccessiblePaths"]
	b.values["BindReadOnlyPaths"] = values["BindReadOnlyPaths"]
	if bindPaths, ok := values["BindPaths"]; ok {
		b.values["BindPaths"] = bindPaths
	} else {
		delete(b.values, "BindPaths")
	}
	b.values["ReadWritePaths"] = values["ReadWritePaths"]
	b.values["RestrictAddressFamilies"] = values["RestrictAddressFamilies"]
	return b.startErr
}
func (b *fakeSystemBus) UnitProperties(_ context.Context, _ string) (map[string]any, error) {
	if b.propErr != nil {
		return nil, b.propErr
	}
	if b.propGoneOnce && !b.propGoneConsumed {
		b.propGoneConsumed = true
		return nil, dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []interface{}{}}
	}
	if b.propErrAfterStop && b.stopped {
		return nil, dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject", Body: []interface{}{}}
	}
	if b.propGoneOnceAfterStop && b.stopped && !b.propGoneConsumed {
		b.propGoneConsumed = true
		return nil, dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []interface{}{}}
	}
	if b.propGoneOnceAfterStop && b.stopped && b.propGoneConsumed && b.propErrAfterGoneOnce != nil {
		return nil, b.propErrAfterGoneOnce
	}
	if b.stopped && b.postStopPropertiesNext < len(b.postStopProperties) {
		response := b.postStopProperties[b.postStopPropertiesNext]
		b.postStopPropertiesNext++
		return response.values, response.err
	}
	if b.propGoneAfterStop && b.stopped {
		b.propertiesAfterStop++
		if b.propertiesAfterStop > 1 {
			return nil, dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject", Body: []interface{}{}}
		}
	}
	if b.propErrAfterFirstStopProperties != nil && b.stopped {
		b.propertiesAfterStop++
		if b.propertiesAfterStop > 1 {
			return nil, b.propErrAfterFirstStopProperties
		}
	}
	if b.valuesAfterFirstStopProperties != nil && b.stopped {
		b.propertiesAfterStop++
		if b.propertiesAfterStop > 1 {
			return b.valuesAfterFirstStopProperties, nil
		}
	}
	return b.values, nil
}
func (b *fakeSystemBus) StopUnit(_ context.Context, _ string) error {
	if b.onStop != nil {
		b.onStop()
	}
	b.stopped = true
	if b.stopDBusErrorName != "" {
		return dbus.Error{Name: b.stopDBusErrorName, Body: []interface{}{}}
	}
	return b.stopErr
}
func (b *fakeSystemBus) KillUnit(_ context.Context, _ string) error { return b.killErr }
func (b *fakeSystemBus) ResetFailedUnit(_ context.Context, _ string) error {
	b.reset = true
	return b.resetErr
}

type fakeFS struct {
	files           map[string][]byte
	writes          map[string][]byte
	writeErr        error
	removed         map[string]bool
	reads           map[string]int
	failReadAt      map[string]int
	readErr         map[string]error
	removeErr       error
	afterRead       func(string)
	runtimeContents []byte
	runtimeRootMode os.FileMode
	chmods          []os.FileMode
}

func newFakeFS() *fakeFS {
	return &fakeFS{files: map[string][]byte{cgroupFile("/crux.slice/test", "memory.max"): []byte("536870912\n"), cgroupFile("/crux.slice/test", "memory.current"): []byte("1024\n"), cgroupFile("/crux.slice/test", "memory.peak"): []byte("2048\n"), cgroupFile("/crux.slice/test", "memory.events"): []byte("low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n"), cgroupFile("/crux.slice/test", "memory.swap.max"): []byte("0\n"), cgroupFile("/crux.slice/test", "pids.max"): []byte("32\n"), cgroupFile("/crux.slice/test", "pids.events"): []byte("max 0\n"), cgroupFile("/crux.slice/test", "cpu.max"): []byte("600000 1000000\n"), cgroupFile("/crux.slice/test", "cgroup.procs"): []byte("42\n43\n"), cgroupFile("/crux.slice/test", "cgroup.events"): []byte("populated 1\n"), cgroupFile("/crux.slice/test", "cpu.stat"): []byte("usage_usec 11\nnr_periods 1\nnr_throttled 0\nthrottled_usec 0\n")}, writes: map[string][]byte{}, removed: map[string]bool{}, reads: map[string]int{}, failReadAt: map[string]int{}, readErr: map[string]error{}}
}
func (f *fakeFS) ReadFile(path string) ([]byte, error) {
	if strings.HasSuffix(path, "/.complete") {
		return append([]byte(nil), f.runtimeContents...), nil
	}
	f.reads[path]++
	if failAt := f.failReadAt[path]; failAt > 0 && f.reads[path] >= failAt {
		return nil, os.ErrNotExist
	}
	if err := f.readErr[path]; err != nil {
		return nil, err
	}
	v, ok := f.files[path]
	if !ok {
		return nil, os.ErrNotExist
	}
	if f.afterRead != nil {
		f.afterRead(path)
	}
	return v, nil
}
func (f *fakeFS) Lstat(path string) (os.FileInfo, error) {
	if strings.HasSuffix(path, "/root") {
		return fakeRuntimeInfo{name: "root", mode: os.ModeSymlink | 0o777}, nil
	}
	if strings.HasSuffix(path, runtimeTarget) {
		mode := f.runtimeRootMode
		if mode == 0 {
			mode = os.ModeDir | 0o555
		}
		return fakeRuntimeInfo{name: "runtime", mode: mode}, nil
	}
	if strings.HasSuffix(path, runtimeTarget+"/.complete") {
		return fakeRuntimeInfo{name: ".complete", mode: 0o444, size: int64(len(f.runtimeContents))}, nil
	}
	return nil, os.ErrNotExist
}
func (f *fakeFS) ReadDir(path string) ([]os.DirEntry, error) {
	if strings.HasSuffix(path, runtimeTarget) {
		return []os.DirEntry{fakeRuntimeEntry{fakeRuntimeInfo{name: ".complete", mode: 0o444}}}, nil
	}
	return nil, os.ErrNotExist
}
func (f *fakeFS) WriteFile(path string, contents []byte) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	f.writes[path] = append([]byte(nil), contents...)
	return nil
}
func (f *fakeFS) RemoveAll(path string) error  { f.removed[path] = true; return f.removeErr }
func (f *fakeFS) Chown(string, int, int) error { return nil }
func (f *fakeFS) Chmod(_ string, mode os.FileMode) error {
	f.chmods = append(f.chmods, mode)
	return nil
}

type fakeRuntimeInfo struct {
	name string
	mode os.FileMode
	size int64
}

func (i fakeRuntimeInfo) Name() string       { return i.name }
func (i fakeRuntimeInfo) Size() int64        { return i.size }
func (i fakeRuntimeInfo) Mode() os.FileMode  { return i.mode }
func (i fakeRuntimeInfo) ModTime() time.Time { return time.Time{} }
func (i fakeRuntimeInfo) IsDir() bool        { return i.mode.IsDir() }
func (i fakeRuntimeInfo) Sys() any           { return nil }

type fakeRuntimeEntry struct{ fakeRuntimeInfo }

func (e fakeRuntimeEntry) Type() os.FileMode          { return e.mode.Type() }
func (e fakeRuntimeEntry) Info() (os.FileInfo, error) { return e.fakeRuntimeInfo, nil }

type missingProcRuntimeFS struct{}

func (missingProcRuntimeFS) Lstat(string) (os.FileInfo, error) { return nil, os.ErrNotExist }
func (missingProcRuntimeFS) ReadDir(string) ([]os.DirEntry, error) {
	return nil, os.ErrNotExist
}
func (missingProcRuntimeFS) ReadFile(string) ([]byte, error) { return nil, os.ErrNotExist }

type immediateClock struct{}

func (immediateClock) Now() time.Time { return time.Now() }
func (immediateClock) After(time.Duration) <-chan time.Time {
	ch := make(chan time.Time, 1)
	ch <- time.Now()
	return ch
}
func propertiesByName(properties []DBusProperty) map[string]any {
	result := make(map[string]any, len(properties))
	for _, property := range properties {
		result[property.Name] = property.Value
	}
	return result
}
func sameProperty(a, b any) bool { return reflect.DeepEqual(a, b) }

func TestStopDoesNotReturnAlreadyGoneWhenPropertiesAreGone(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.propErr = dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []interface{}{}}
	bus.killErr = errors.New("denied")
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatalf("properties-gone must not manufacture proof: %v", err)
	}
}

func TestStopClassifiesFailuresWithFixedReasons(t *testing.T) {
	privateUnit := "private-unit-secret.service"
	privatePath := "/private/cgroup/path"
	for _, test := range []struct {
		name  string
		setup func(*fakeSystemBus, *fakeFS)
		want  string
	}{
		{
			name: "properties typed gone",
			setup: func(bus *fakeSystemBus, _ *fakeFS) {
				bus.stopDBusErrorName = "org.freedesktop.DBus.Error.AccessDenied"
				bus.killErr = errors.New("kill private-unit-secret.service")
				bus.propErr = dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject", Body: []any{privatePath}}
			},
			want: "unit-properties-gone",
		},
		{
			name: "properties unavailable",
			setup: func(bus *fakeSystemBus, _ *fakeFS) {
				bus.stopDBusErrorName = "org.freedesktop.DBus.Error.InvalidArgs"
				bus.killErr = errors.New("kill private-unit-secret.service")
				bus.propErr = errors.New("properties " + privatePath)
			},
			want: "unit-properties-unavailable",
		},
		{
			name: "invalid cgroup",
			setup: func(bus *fakeSystemBus, _ *fakeFS) {
				bus.stopDBusErrorName = "org.freedesktop.DBus.Error.AccessDenied"
				bus.killErr = errors.New("kill private-unit-secret.service")
				bus.values["ControlGroup"] = "relative" + privatePath
			},
			want: "unit-properties-invalid-cgroup",
		},
		{
			name: "cgroup kill unavailable",
			setup: func(bus *fakeSystemBus, fs *fakeFS) {
				bus.stopDBusErrorName = "org.freedesktop.DBus.Error.Custom"
				bus.killErr = errors.New("kill private-unit-secret.service")
				fs.writeErr = errors.New("write " + privatePath)
			},
			want: "cgroup-kill-unavailable",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			fs := newFakeFS()
			test.setup(bus, fs)
			err := (&systemdUnit{name: privateUnit, bus: bus, fs: fs, now: immediateClock{}}).Stop(context.Background())
			var failure *stopFailure
			if !errors.As(err, &failure) || failure.reason != test.want {
				t.Fatalf("stopFailure = %#v, want reason %q", failure, test.want)
			}
			if strings.Contains(err.Error(), privateUnit) || strings.Contains(err.Error(), privatePath) {
				t.Fatalf("stop diagnostic leaked private data: %q", err)
			}
		})
	}
}

func TestCleanupUsesTypedStopFailureReason(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	bus.stopDBusErrorName = "org.freedesktop.DBus.Error.AccessDenied"
	bus.killErr = errors.New("kill private-unit-secret.service")
	bus.propErrAfterStop = true
	u := &systemdUnit{name: "private-unit-secret.service", bus: bus, fs: fs, now: immediateClock{}}
	_, _, _, reason := cleanup(u)
	if reason != "unit-properties-gone" {
		t.Fatalf("cleanup reason = %q", reason)
	}
}

func TestStopDoesNotReturnAlreadyGoneWhenPropertiesUnknownObject(t *testing.T) {
	// UnitProperties may report UnknownObject, but it cannot prove success.
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.propErr = dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject", Body: []interface{}{}}
	bus.killErr = errors.New("denied")
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatalf("properties UnknownObject must not manufacture proof: %v", err)
	}
}

func TestStopReturnsUnitAlreadyGoneWhenNoSuchUnitAndSuccessfulInactiveProps(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	bus.values["ExecMainStatus"] = int32(0)
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	if _, err := u.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if !errors.As(err, &alreadyGone) || alreadyGone.cgroup != "/crux.slice/test" || !successfulInactiveTerminal(alreadyGone.proof.State, alreadyGone.proof.MainPID, alreadyGone.proof.ServiceResult, alreadyGone.proof.ExecMainStatus) {
		t.Fatalf("expected strict already-gone proof, got %v", err)
	}
}

func TestStopDoesNotTreatUnknownObjectFromStopUnitAsAlreadyGone(t *testing.T) {
	// Manager.StopUnit accepts ONLY NoSuchUnit; UnknownObject must remain a failure.
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.DBus.Error.UnknownObject"
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	bus.values["ExecMainStatus"] = int32(0)
	bus.killErr = errors.New("denied")
	// Force cgroup.kill path to fail so Stop returns an error.
	bus.values["ControlGroup"] = ""
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatal("UnknownObject from StopUnit must not classify as alreadyGone")
	}
	if err == nil {
		t.Fatal("expected stop failure for UnknownObject from StopUnit")
	}
}

func TestStopDoesNotTreatFailedStateAsAlreadyGone(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "failed"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "exit-code"
	bus.values["ExecMainStatus"] = int32(1)
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatal("failed/exit-code terminal must not classify as alreadyGone")
	}
	if err != nil {
		t.Fatalf("expected kill fallback success, got %v", err)
	}
}

func TestStopDoesNotTreatOOMKillResultAsAlreadyGone(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "oom-kill"
	bus.values["ExecMainStatus"] = int32(0)
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatal("oom-kill Result must not classify as alreadyGone")
	}
	if err != nil {
		t.Fatalf("expected kill fallback success, got %v", err)
	}
}

func TestStopDoesNotTreatNonzeroExecMainStatusAsAlreadyGone(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	bus.values["ExecMainStatus"] = int32(76)
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatal("nonzero ExecMainStatus must not classify as alreadyGone")
	}
	if err != nil {
		t.Fatalf("expected kill fallback success, got %v", err)
	}
}

func TestStopDoesNotTreatArbitraryPropertiesErrorAsAlreadyGone(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.propErr = errors.New("not found")
	fs := newFakeFS()
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}, tmp: "/run/anydoc/private"}
	// Kill also fails; UnitProperties fails so cgroup.kill cannot run either.
	bus.killErr = errors.New("denied")
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatal("arbitrary UnitProperties error must not classify as alreadyGone")
	}
	if err == nil {
		t.Fatal("expected stop failure when termination is unproved")
	}
}

func TestStopFallsBackToKillWhenUnitStillActive(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "active"
	bus.values["MainPID"] = uint32(42)
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}, tmp: "/run/anydoc/private"}
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if errors.As(err, &alreadyGone) {
		t.Fatal("unit should fall back to kill, not return alreadyGone")
	}
	if err != nil {
		t.Fatalf("expected nil after kill succeeded, got %v", err)
	}
}

func TestCleanupAlreadyGoneAbsentWithTerminalSucceeds(t *testing.T) {
	private := "/private/dbus-body-secret"
	for _, test := range []struct {
		name       string
		statusErr  error
		wantReason string
	}{
		{name: "NoSuchUnit", statusErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}},
		{name: "UnknownObject", statusErr: dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject"}},
		{name: "arbitrary", statusErr: errors.New("terminal unavailable"), wantReason: "already-gone-terminal-unavailable"},
		{name: "access denied", statusErr: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, wantReason: "already-gone-terminal-unrecognized-dbus"},
		{name: "access denied pointer", statusErr: &dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, wantReason: "already-gone-terminal-unrecognized-dbus"},
		{name: "wrapped access denied", statusErr: fmt.Errorf("wrapped: %w", &dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}), wantReason: "already-gone-terminal-unrecognized-dbus"},
	} {
		t.Run(test.name, func(t *testing.T) {
			u, bus := prepareAlreadyGoneCleanup(t, nil)
			bus.propErrAfterFirstStopProperties = test.statusErr
			_, _, _, reason := cleanup(u)
			if reason != test.wantReason {
				t.Fatalf("cleanup reason = %q, want %q", reason, test.wantReason)
			}
			if strings.Contains(reason, private) || strings.Contains(reason, "AccessDenied") {
				t.Fatalf("cleanup reason leaked D-Bus detail: %q", reason)
			}
		})
	}
}

func TestTerminalStatusPreservesSanitizedOperationClassification(t *testing.T) {
	private := "/private/dbus-body-secret"
	for _, test := range []struct {
		name  string
		err   error
		class terminalStatusDBusClass
	}{
		{name: "NoSuchUnit", err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, class: terminalStatusDBusGone},
		{name: "UnknownObject", err: dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject"}, class: terminalStatusDBusGone},
		{name: "wrapped NoSuchUnit", err: fmt.Errorf("wrapped: %w", &dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}), class: terminalStatusDBusGone},
		{name: "arbitrary", err: errors.New("terminal unavailable")},
		{name: "access denied", err: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, class: terminalStatusDBusUnrecognized},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			bus.propErr = test.err
			u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus}
			_, err := u.TerminalStatus(context.Background())
			var operation *terminalStatusOperationError
			if !errors.As(err, &operation) || operation.stage != terminalStatusUnitProperties || operation.dbusClass != test.class {
				t.Fatalf("TerminalStatus() = %T %v, want unit-properties operation class %v", err, err, test.class)
			}
			var source *dbus.Error
			if errors.As(err, &source) {
				t.Fatalf("TerminalStatus() retained the source D-Bus error: %T", source)
			}
		})
	}
}

func TestTerminalStatusUnavailableStagesAreSafeAndValidateAlreadyGone(t *testing.T) {
	private := "/private/dbus-body-secret"
	carried := &alreadyGoneError{
		proof:  TerminalStatus{State: "inactive", ServiceResult: "success"},
		cgroup: "/safe",
	}
	termination := TerminationEvidence{ControlGroup: "/safe", Empty: true}

	for _, test := range []struct {
		name       string
		err        error
		values     map[string]any
		wantReason string
	}{
		{
			name:       "GetUnit generic error",
			err:        newTerminalStatusOperationError(terminalStatusGetUnit, errors.New(private)),
			wantReason: "already-gone-terminal-get-unit-unavailable",
		},
		{
			name:       "Unit GetAll generic error",
			err:        newTerminalStatusOperationError(terminalStatusUnitProperties, errors.New(private)),
			wantReason: "already-gone-terminal-unit-properties-unavailable",
		},
		{
			name:       "Service GetAll generic error",
			err:        newTerminalStatusOperationError(terminalStatusServiceProperties, errors.New(private)),
			wantReason: "already-gone-terminal-service-properties-unavailable",
		},
		{
			name:       "GetUnit exact gone value",
			err:        newTerminalStatusOperationError(terminalStatusGetUnit, dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}),
			wantReason: "already-gone-terminal-get-unit-gone",
		},
		{
			name:       "GetUnit unrecognized D-Bus wrapped",
			err:        newTerminalStatusOperationError(terminalStatusGetUnit, fmt.Errorf("wrapped: %w", &dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}})),
			wantReason: "already-gone-terminal-get-unit-unrecognized",
		},
		{
			name:       "decode invalid",
			values:     map[string]any{"ActiveState": "inactive", "Result": "success", "MainPID": private, "ExecMainStatus": uint32(0)},
			wantReason: "already-gone-terminal-decode-unavailable",
		},
		{
			name:       "decode incomplete",
			values:     map[string]any{"ActiveState": "inactive", "Result": "success", "MainPID": uint32(0)},
			wantReason: "already-gone-terminal-decode-unavailable",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			bus.propErr = test.err
			if test.values != nil {
				bus.values = test.values
			}
			u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus}
			_, err := u.TerminalStatus(context.Background())

			if test.err != nil {
				var operation *terminalStatusOperationError
				if !errors.As(err, &operation) {
					t.Fatalf("TerminalStatus() = %T %v, want operation error", err, err)
				}
				if input, ok := test.err.(*terminalStatusOperationError); ok && operation != input {
					t.Fatal("TerminalStatus() replaced the sanitized operation error")
				}
			}

			reason := validateAlreadyGone("/safe", termination, nil, TerminalStatus{}, err, carried)
			if reason != test.wantReason {
				t.Fatalf("validateAlreadyGone() = %q, want %q", reason, test.wantReason)
			}
			if strings.Contains(err.Error(), private) || strings.Contains(reason, private) || strings.Contains(err.Error(), "AccessDenied") || strings.Contains(reason, "AccessDenied") {
				t.Fatalf("terminal status result leaked private D-Bus detail: err %q, reason %q", err, reason)
			}
		})
	}
}

func TestValidateAlreadyGoneTerminalOperationErrorMappingNoLeak(t *testing.T) {
	private := "/private/dbus-body-secret"
	carried := &alreadyGoneError{
		proof:  TerminalStatus{State: "inactive", ServiceResult: "success"},
		cgroup: "/safe",
	}
	termination := TerminationEvidence{ControlGroup: "/safe", Empty: true}

	for _, test := range []struct {
		name  string
		stage terminalStatusUnavailableStage
		class terminalStatusDBusClass
		want  string
	}{
		{name: "get unit gone", stage: terminalStatusGetUnit, class: terminalStatusDBusGone, want: "already-gone-terminal-get-unit-gone"},
		{name: "get unit unrecognized", stage: terminalStatusGetUnit, class: terminalStatusDBusUnrecognized, want: "already-gone-terminal-get-unit-unrecognized"},
		{name: "get unit unavailable", stage: terminalStatusGetUnit, class: terminalStatusDBusGeneric, want: "already-gone-terminal-get-unit-unavailable"},
		{name: "unit properties gone", stage: terminalStatusUnitProperties, class: terminalStatusDBusGone, want: "already-gone-terminal-unit-properties-gone"},
		{name: "unit properties unrecognized", stage: terminalStatusUnitProperties, class: terminalStatusDBusUnrecognized, want: "already-gone-terminal-unit-properties-unrecognized"},
		{name: "unit properties unavailable", stage: terminalStatusUnitProperties, class: terminalStatusDBusGeneric, want: "already-gone-terminal-unit-properties-unavailable"},
		{name: "service properties gone", stage: terminalStatusServiceProperties, class: terminalStatusDBusGone, want: "already-gone-terminal-service-properties-gone"},
		{name: "service properties unrecognized", stage: terminalStatusServiceProperties, class: terminalStatusDBusUnrecognized, want: "already-gone-terminal-service-properties-unrecognized"},
		{name: "service properties unavailable", stage: terminalStatusServiceProperties, class: terminalStatusDBusGeneric, want: "already-gone-terminal-service-properties-unavailable"},
		{name: "decode gone", stage: terminalStatusDecode, class: terminalStatusDBusGone, want: "already-gone-terminal-decode-unavailable"},
		{name: "decode unrecognized", stage: terminalStatusDecode, class: terminalStatusDBusUnrecognized, want: "already-gone-terminal-decode-unavailable"},
		{name: "decode unavailable", stage: terminalStatusDecode, class: terminalStatusDBusGeneric, want: "already-gone-terminal-decode-unavailable"},
		{name: "unknown stage", stage: terminalStatusUnavailableStage("private-stage"), class: terminalStatusDBusGone, want: "already-gone-terminal-unavailable"},
		{name: "unknown class", stage: terminalStatusGetUnit, class: terminalStatusDBusClass(99), want: "already-gone-terminal-unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := &terminalStatusOperationError{stage: test.stage, dbusClass: test.class}
			reason := validateAlreadyGone("/safe", termination, nil, TerminalStatus{}, err, carried)
			if reason != test.want {
				t.Fatalf("validateAlreadyGone() = %q, want %q", reason, test.want)
			}
			if reason == "" || !validContainmentReason(reason) {
				t.Fatalf("reason was accepted or not allowlisted: %q", reason)
			}
			if strings.Contains(err.Error(), private) || strings.Contains(reason, private) {
				t.Fatalf("operation diagnostic leaked private detail: err %q, reason %q", err, reason)
			}
		})
	}
}

func TestValidateAlreadyGoneTerminalStatusFinalErrorAcceptance(t *testing.T) {
	carried := &alreadyGoneError{
		proof:  TerminalStatus{State: "inactive", ServiceResult: "success"},
		cgroup: "/safe",
	}
	termination := TerminationEvidence{ControlGroup: "/safe", Absent: true}

	for _, test := range []struct {
		name string
		err  error
		want string
	}{
		{name: "final gone accepts", err: &terminalStatusGoneError{}},
		{name: "final unrecognized rejects", err: &terminalStatusUnrecognizedDBusError{}, want: "already-gone-terminal-unrecognized-dbus"},
		{name: "direct operation gone rejects", err: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, want: "already-gone-terminal-get-unit-gone"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := validateAlreadyGone("/safe", termination, nil, TerminalStatus{}, test.err, carried); got != test.want {
				t.Fatalf("validateAlreadyGone() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestDBusUnitPropertiesStagesEveryOperation(t *testing.T) {
	for _, test := range []struct {
		name  string
		calls []*dbus.Call
		stage terminalStatusUnavailableStage
	}{
		{
			name:  "GetUnit",
			calls: []*dbus.Call{{Err: errors.New("private GetUnit failure")}},
			stage: terminalStatusGetUnit,
		},
		{
			name: "Unit GetAll",
			calls: []*dbus.Call{
				{Body: []any{dbus.ObjectPath("/private/unit/path")}},
				{Err: errors.New("private Unit GetAll failure")},
			},
			stage: terminalStatusUnitProperties,
		},
		{
			name: "Service GetAll",
			calls: []*dbus.Call{
				{Body: []any{dbus.ObjectPath("/private/unit/path")}},
				{Body: []any{map[string]dbus.Variant{}}},
				{Err: errors.New("private Service GetAll failure")},
			},
			stage: terminalStatusServiceProperties,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			object := &fakeDBusObject{calls: test.calls}
			_, err := dbusUnitProperties(context.Background(), object, func(dbus.ObjectPath) dbus.BusObject {
				return object
			}, "crux-anydoc-test.service")
			var unavailable *terminalStatusOperationError
			if !errors.As(err, &unavailable) || unavailable.stage != test.stage {
				t.Fatalf("dbusUnitProperties() error = %T %v, want stage %q", err, err, test.stage)
			}
			if strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "path") {
				t.Fatalf("dbusUnitProperties() leaked operation detail: %q", err)
			}
		})
	}
}

func TestTerminalStatusOperationErrorsReachCleanupViaDBusUnitProperties(t *testing.T) {
	for _, test := range []struct {
		name  string
		calls []*dbus.Call
		want  string
	}{
		{
			name:  "GetUnit",
			calls: []*dbus.Call{{Err: errors.New("private GetUnit failure")}},
			want:  "already-gone-terminal-get-unit-unavailable",
		},
		{
			name: "Unit GetAll",
			calls: []*dbus.Call{
				{Body: []any{dbus.ObjectPath("/private/unit/path")}},
				{Err: errors.New("private Unit GetAll failure")},
			},
			want: "already-gone-terminal-unit-properties-unavailable",
		},
		{
			name: "Service GetAll exact gone",
			calls: []*dbus.Call{
				{Body: []any{dbus.ObjectPath("/private/unit/path")}},
				{Body: []any{map[string]dbus.Variant{}}},
				{Err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{"/private/dbus-body-secret"}}},
			},
			want: "already-gone-terminal-service-properties-gone",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			u, base := prepareAlreadyGoneCleanup(t, nil)
			bus := &dbusHelperSystemBus{fakeSystemBus: base}
			postStopProperties := 0
			bus.unitProperties = func(ctx context.Context, name string) (map[string]any, error) {
				if !base.stopped {
					return base.UnitProperties(ctx, name)
				}
				postStopProperties++
				if postStopProperties == 1 {
					// StopUnit's exact missing-unit proof remains strict and carried.
					return base.UnitProperties(ctx, name)
				}
				object := &fakeDBusObject{calls: append([]*dbus.Call(nil), test.calls...)}
				return dbusUnitProperties(ctx, object, func(dbus.ObjectPath) dbus.BusObject {
					return object
				}, name)
			}
			u.bus = bus

			_, _, termination, reason := cleanup(u)
			if termination != (TerminationEvidence{ControlGroup: "/crux.slice/test", Absent: true}) {
				t.Fatalf("cleanup termination = %#v, want exact absent evidence", termination)
			}
			if reason != test.want {
				t.Fatalf("cleanup reason = %q, want %q", reason, test.want)
			}
		})
	}
}

func TestGodbusSystemBusWithoutConnectionKeepsGetUnitOperation(t *testing.T) {
	bus := &godbusSystemBus{}
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus}
	_, err := u.TerminalStatus(context.Background())
	var operation *terminalStatusOperationError
	if !errors.As(err, &operation) || operation.stage != terminalStatusGetUnit || operation.dbusClass != terminalStatusDBusGeneric {
		t.Fatalf("TerminalStatus() = %T %v, want sanitized get-unit operation error", err, err)
	}
}

func TestDBusUnitPropertiesGoneRecognizesOnlyExactAndSanitizedGone(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want bool
	}{
		{name: "raw NoSuchUnit", err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, want: true},
		{name: "wrapped raw UnknownObject", err: fmt.Errorf("wrapped: %w", &dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject"}), want: true},
		{name: "sanitized gone", err: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, want: true},
		{name: "wrapped sanitized gone", err: fmt.Errorf("wrapped: %w", &terminalStatusOperationError{stage: terminalStatusUnitProperties, dbusClass: terminalStatusDBusGone}), want: true},
		{name: "sanitized generic", err: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGeneric}},
		{name: "sanitized unrecognized", err: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusUnrecognized}},
		{name: "raw unrecognized", err: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied"}},
		{name: "generic", err: errors.New("unavailable")},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := isDbusUnitPropertiesGone(test.err); got != test.want {
				t.Fatalf("isDbusUnitPropertiesGone() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestDBusUnitPropertiesHelperPreservesReportAndStopGoneSemantics(t *testing.T) {
	private := "/private/dbus-body-secret"
	for _, test := range []struct {
		name           string
		err            error
		wantReportGone bool
		wantStopReason string
	}{
		{name: "exact gone", err: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}, wantReportGone: true, wantStopReason: "unit-properties-gone"},
		{name: "unrecognized", err: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, wantStopReason: "unit-properties-unavailable"},
		{name: "generic", err: errors.New(private), wantStopReason: "unit-properties-unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			base := newFakeSystemBus()
			bus := &dbusHelperSystemBus{
				fakeSystemBus:  base,
				unitProperties: dbusUnitPropertiesError(test.err),
			}
			unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: newFakeFS(), now: immediateClock{}}

			_, reportErr := unit.Report(context.Background())
			var capture *terminalAccountingCaptureError
			if got := errors.As(reportErr, &capture); got != test.wantReportGone {
				t.Fatalf("Report() report-gone classification = %t, want %t (err %v)", got, test.wantReportGone, reportErr)
			}
			if capture != nil && capture.failure != accountingCaptureReportGone {
				t.Fatalf("Report() failure = %v, want %v", capture.failure, accountingCaptureReportGone)
			}

			base.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
			base.killErr = errors.New("kill unavailable")
			stopErr := unit.Stop(context.Background())
			var failure *stopFailure
			if !errors.As(stopErr, &failure) || failure.reason != test.wantStopReason {
				t.Fatalf("Stop() = %v, want stop reason %q", stopErr, test.wantStopReason)
			}
			if strings.Contains(stopErr.Error(), private) || strings.Contains(stopErr.Error(), "AccessDenied") {
				t.Fatalf("Stop() leaked D-Bus detail: %q", stopErr)
			}
		})
	}
}

func TestCleanupCachesReportGoneFromDBusUnitPropertiesHelper(t *testing.T) {
	base := newFakeSystemBus()
	bus := &dbusHelperSystemBus{fakeSystemBus: base}
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-report-gone.service", bus: bus, fs: fs, now: immediateClock{}}

	first, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	unit.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := unit.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := unit.CPUUsage(context.Background()); err != nil {
		t.Fatal(err)
	}
	unit.MarkSnapshotVerified()

	reportGone := true
	bus.unitProperties = func(ctx context.Context, name string) (map[string]any, error) {
		if reportGone {
			reportGone = false
			return dbusUnitPropertiesError(dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"})(ctx, name)
		}
		return base.UnitProperties(ctx, name)
	}
	base.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	base.values["ActiveState"] = "inactive"
	base.values["MainPID"] = uint32(0)
	base.values["Result"] = "success"
	base.values["ExecMainStatus"] = int32(0)
	base.onStop = func() {
		fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
		fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = []byte{}
	}

	report, _, termination, reason := cleanup(unit)
	if reason != "" {
		t.Fatalf("cleanup reason = %q, want success", reason)
	}
	if report.ControlGroup != first.ControlGroup || termination != (TerminationEvidence{ControlGroup: first.ControlGroup, Empty: true}) {
		t.Fatalf("cleanup did not reuse verified report-gone snapshot: report %#v termination %#v", report, termination)
	}
}

func TestCleanupUnitPropertiesGoneNeedsVerifiedTerminalReportProof(t *testing.T) {
	for _, test := range []struct {
		name           string
		verify         bool
		terminalReport bool
		mutateDigest   bool
		want           string
	}{
		{name: "accepts exact verified lifecycle", verify: true, terminalReport: true},
		{name: "rejects proof before verification", terminalReport: true, want: "unit-properties-gone-no-verified-snapshot"},
		{name: "rejects stale runtime identity", verify: true, terminalReport: true, mutateDigest: true, want: "unit-properties-gone-runtime-digest-mismatch"},
	} {
		t.Run(test.name, func(t *testing.T) {
			base := newFakeSystemBus()
			postStopCalls := 0
			bus := &dbusHelperSystemBus{fakeSystemBus: base}
			bus.unitProperties = func(ctx context.Context, name string) (map[string]any, error) {
				if base.stopped {
					postStopCalls++
					if postStopCalls == 1 {
						return nil, dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject"}
					}
					return nil, &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}
				}
				return base.UnitProperties(ctx, name)
			}
			fs := newFakeFS()
			u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
			first, err := u.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			u.spec = ServiceSpec{
				runtimeTreeDigest:       first.RuntimeTreeDigest,
				MemoryMax:               first.MemoryMax,
				MemorySwapMax:           first.MemorySwapMax,
				TasksMax:                first.TasksMax,
				CPUQuotaPercent:         first.CPUQuotaPercent,
				CPUQuotaPeriodUSec:      first.CPUQuotaPeriodUSec,
				RuntimeMax:              first.RuntimeMax,
				KillMode:                first.KillMode,
				ProtectSystem:           first.ProtectSystem,
				CPUAccounting:           first.CPUAccounting,
				NoNewPrivileges:         first.NoNewPrivileges,
				PrivateNetwork:          first.PrivateNetwork,
				PrivateTmp:              first.PrivateTmp,
				ProtectHome:             first.ProtectHome,
				ReadOnlyPaths:           first.ReadOnlyPaths,
				InaccessiblePaths:       first.InaccessiblePaths,
				BindReadOnlyPaths:       first.BindReadOnlyPaths,
				ReadWritePaths:          first.ReadWritePaths,
				RestrictAddressFamilies: first.RestrictAddressFamilies,
			}
			if test.verify {
				if !verify(context.Background(), &verifiedLifecycleSystemdUnit{systemdUnit: u}, u.spec) {
					t.Fatal("production verification lifecycle rejected fake unit")
				}
			}
			base.values["ActiveState"] = "inactive"
			base.values["MainPID"] = uint32(0)
			base.values["Result"] = "success"
			base.values["ExecMainStatus"] = int32(0)
			fs.files[cgroupFile("/crux.slice/test", "cgroup.events")] = []byte("populated 0\n")
			fs.files[cgroupFile("/crux.slice/test", "cgroup.procs")] = []byte{}
			if test.terminalReport {
				if _, err := u.report(context.Background(), true); err != nil {
					t.Fatal(err)
				}
			}
			if test.mutateDigest {
				u.snapshotMu.Lock()
				u.snapshot.RuntimeTreeDigest = "different"
				u.snapshotMu.Unlock()
			}
			base.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
			base.killErr = errors.New("kill unavailable")
			report, _, _, reason := cleanup(u)
			if reason != test.want {
				t.Fatalf("cleanup reason = %q, want %q", reason, test.want)
			}
			if reason == "" && report.ControlGroup != first.ControlGroup {
				t.Fatalf("cleanup report cgroup = %q, want %q", report.ControlGroup, first.ControlGroup)
			}
		})
	}
}

func TestRunFinishSystemdUnitPropertiesGoneLifecycle(t *testing.T) {
	const pinned = "/crux.slice/test"
	const private = "/private/final-status-detail"
	strict := map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "success", "ExecMainStatus": int32(0)}

	for _, test := range []struct {
		name        string
		terminal    map[string]any
		final       map[string]any
		finalErr    error
		mutate      func(*systemdUnit)
		termination string
		wantReason  string
		wantService string
		wantClean   bool
	}{
		{name: "accepts bound proof with exact get unit gone and empty cgroup", terminal: strict, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true},
		{name: "accepts bound proof with exact get unit gone and absent cgroup", terminal: strict, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "absent", wantClean: true},
		{name: "rejects failed result", final: map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "exit-code", "ExecMainStatus": int32(0)}, wantReason: "already-gone-terminal-not-success", wantService: "exit-code"},
		{name: "rejects oom kill", final: map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "oom-kill", "ExecMainStatus": int32(0)}, wantReason: "already-gone-terminal-not-success", wantService: "oom-kill"},
		{name: "rejects nonzero main status", final: map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "success", "ExecMainStatus": int32(76)}, wantReason: "already-gone-terminal-not-success"},
		{name: "rejects live terminal without proof", terminal: map[string]any{"ActiveState": "active", "MainPID": uint32(42), "Result": "success", "ExecMainStatus": int32(0)}, wantReason: "unit-properties-gone-proof-missing"},
		{name: "rejects arbitrary final status error", terminal: strict, finalErr: errors.New(private), wantReason: "already-gone-terminal-unit-properties-unavailable"},
		{name: "rejects unrecognized final status error", terminal: strict, finalErr: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, wantReason: "already-gone-terminal-unit-properties-unrecognized"},
		{name: "rejects nonexclusive termination", terminal: strict, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "nonexclusive", wantReason: "already-gone-termination-unavailable"},
		{name: "rejects termination cgroup mismatch", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "mismatch", wantReason: "already-gone-termination-unavailable"},
		{name: "rejects runtime snapshot mismatch", terminal: strict, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, mutate: func(u *systemdUnit) {
			u.snapshotMu.Lock()
			u.snapshot.RuntimeTreeDigest = "stale"
			u.snapshotMu.Unlock()
		}, wantReason: "unit-properties-gone-runtime-digest-mismatch"},
		{name: "rejects unverified snapshot", terminal: strict, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, mutate: func(u *systemdUnit) { u.snapshotMu.Lock(); u.snapshotOK = false; u.snapshotMu.Unlock() }, wantReason: "unit-properties-gone-no-verified-snapshot"},
		{name: "rejects missing proof", terminal: map[string]any{"ActiveState": "active", "MainPID": uint32(42), "Result": "success", "ExecMainStatus": int32(0)}, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, wantReason: "unit-properties-gone-proof-missing"},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			fs := newFakeFS()
			u := &systemdUnit{name: "crux-anydoc-lifecycle.service", bus: bus, fs: fs, now: immediateClock{}}
			active, err := u.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			u.spec.runtimeTreeDigest = active.RuntimeTreeDigest
			if _, err := u.Report(context.Background()); err != nil {
				t.Fatal(err)
			}
			if _, err := u.CPUUsage(context.Background()); err != nil {
				t.Fatal(err)
			}
			u.spec = ServiceSpec{
				runtimeTreeDigest:       active.RuntimeTreeDigest,
				MemoryMax:               active.MemoryMax,
				MemorySwapMax:           active.MemorySwapMax,
				TasksMax:                active.TasksMax,
				CPUQuotaPercent:         active.CPUQuotaPercent,
				CPUQuotaPeriodUSec:      active.CPUQuotaPeriodUSec,
				RuntimeMax:              active.RuntimeMax,
				KillMode:                active.KillMode,
				ProtectSystem:           active.ProtectSystem,
				CPUAccounting:           active.CPUAccounting,
				NoNewPrivileges:         active.NoNewPrivileges,
				PrivateNetwork:          active.PrivateNetwork,
				PrivateTmp:              active.PrivateTmp,
				ProtectHome:             active.ProtectHome,
				ReadOnlyPaths:           active.ReadOnlyPaths,
				InaccessiblePaths:       active.InaccessiblePaths,
				BindReadOnlyPaths:       active.BindReadOnlyPaths,
				ReadWritePaths:          active.ReadWritePaths,
				RestrictAddressFamilies: active.RestrictAddressFamilies,
			}
			if !verify(context.Background(), &verifiedLifecycleSystemdUnit{systemdUnit: u}, u.spec) {
				t.Fatal("production verification lifecycle rejected fake unit")
			}

			terminalReport := strict
			if test.terminal != nil {
				terminalReport = test.terminal
			}
			for key, value := range terminalReport {
				bus.values[key] = value
			}
			if _, err := u.report(context.Background(), true); err != nil {
				t.Fatalf("strict terminal Report() = %v", err)
			}
			if test.mutate != nil {
				test.mutate(u)
			}

			bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
			bus.killErr = errors.New("kill " + private)
			bus.propGoneOnceAfterStop = true
			bus.propErrAfterGoneOnce = test.finalErr
			if test.finalErr == nil && terminalReport["ActiveState"] == "active" {
				// The first gone response is consumed while stopping. Follow the
				// live pre-stop report with a finite gone status so WaitInactive
				// reaches the final proof validation instead of polling forever.
				bus.propErrAfterGoneOnce = &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}
			}
			bus.valuesAfterFirstStopProperties = terminalReport
			if test.final != nil {
				bus.valuesAfterFirstStopProperties = test.final
			}
			bus.onStop = func() {
				fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 0\n")
				fs.files[cgroupFile(pinned, "cgroup.procs")] = []byte{}
				switch test.termination {
				case "empty":
					fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 0\n")
					fs.files[cgroupFile(pinned, "cgroup.procs")] = []byte{}
				case "absent":
					delete(fs.files, cgroupFile(pinned, "cgroup.events"))
					delete(fs.files, cgroupFile(pinned, "cgroup.procs"))
				case "nonexclusive":
					fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 0\n")
					fs.files[cgroupFile(pinned, "cgroup.procs")] = []byte{}
					fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 1\n")
				case "mismatch":
					u.reportMu.Lock()
					u.controlGroup = "/crux.slice/other"
					u.reportMu.Unlock()
				}
			}

			staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
			if err != nil {
				t.Fatal(err)
			}
			read, write, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer read.Close()
			defer write.Close()
			run := &Run{unit: u, write: write, staged: staged, stop: make(chan struct{}), finished: make(chan struct{}), started: time.Now()}
			finishErr := run.Finish(context.Background(), nil)
			terminal := run.TerminalReport()
			if terminal.Cleaned != test.wantClean || (test.wantClean && terminal.Outcome != OutcomeSuccess) || (!test.wantClean && terminal.Outcome != ErrContainmentUnavailable) {
				t.Fatalf("terminal report = %#v, want cleaned=%t", terminal, test.wantClean)
			}
			if test.wantClean {
				if terminal.PreStop.ControlGroup != pinned || terminal.Termination.ControlGroup != pinned || terminal.Termination.Empty == terminal.Termination.Absent || finishErr != nil {
					t.Fatalf("accepted lifecycle evidence = %#v err=%v", terminal, finishErr)
				}
				return
			}
			service := test.wantService
			if service == "" {
				service = "success"
			}
			want := "error=containment-unavailable outcome=containment-unavailable service=" + service + " stage=containment-cleanup reason=" + test.wantReason + " oom-killed=false pids-limited=false"
			if got := safeExecutionFailure(finishErr, terminal); got != want || strings.Contains(got, private) || strings.Contains(got, pinned) {
				t.Fatalf("safe diagnostic = %q, want %q without raw detail", got, want)
			}
		})
	}
}

func TestRunFinishUnitPropertiesGoneACKWitnessLifecycle(t *testing.T) {
	const pinned = "/crux.slice/test"
	const private = "/private/final-status-detail"
	strict := map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "success", "ExecMainStatus": int32(0)}

	for _, test := range []struct {
		name        string
		receive     string
		mutate      func(*systemdUnit, *fakeFS)
		terminalProof bool
		finalErr    error
		termination string
		wantReason  string
		wantSafe    string
		wantClean   bool
		wantOutcome WorkloadOutcomeCode
		wantError   ErrorCode
		validation  string
	}{
		{name: "accepts acknowledged parser failure with exact gone and empty cgroup", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeInvalidResult, wantError: ErrEncrypted},
		{name: "accepts acknowledged parser failure with exact gone and absent cgroup", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "absent", wantClean: true, wantOutcome: WorkloadOutcomeInvalidResult, wantError: ErrEncrypted},
		{name: "rejects missing witness", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantReason: "unit-properties-gone-proof-missing"},
		{name: "accepts mismatched request with independent terminal success proof", receive: "mismatch", terminalProof: true, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeInvalidResult, wantError: ErrInvalidResult, validation: "request-binding"},
		{name: "accepts failed ACK with independent terminal success proof", receive: "ack-write", terminalProof: true, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeInvalidResult, wantError: ErrInvalidResult, validation: "ack-write"},
		{name: "accepts OOM with independent terminal proof", receive: "valid", terminalProof: true, mutate: func(u *systemdUnit, fs *fakeFS) {
			u.snapshotMu.Lock()
			u.snapshot.MemoryEvents["oom"] = 1
			u.snapshotMu.Unlock()
			fs.files[cgroupFile(pinned, "memory.events")] = []byte("oom 1\noom_kill 0\n")
		}, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeOOM, wantError: ErrEncrypted},
		{name: "accepts OOM kill with independent terminal proof", receive: "valid", terminalProof: true, mutate: func(u *systemdUnit, fs *fakeFS) {
			u.snapshotMu.Lock()
			u.snapshot.MemoryEvents["oom_kill"] = 1
			u.snapshotMu.Unlock()
			fs.files[cgroupFile(pinned, "memory.events")] = []byte("oom 0\noom_kill 1\n")
		}, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeOOM, wantError: ErrEncrypted},
		{name: "rejects pids limit without terminal proof", receive: "valid", mutate: func(u *systemdUnit, fs *fakeFS) {
			u.snapshotMu.Lock()
			u.snapshot.PIDsEvents["max"] = 1
			u.snapshotMu.Unlock()
			fs.files[cgroupFile(pinned, "pids.events")] = []byte("max 1\n")
		}, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantSafe: "error=containment-unavailable outcome=containment-unavailable service=success stage=containment-cleanup reason=runtime-target-missing-snapshot-pids-max oom-killed=false pids-limited=true"},
		{name: "accepts pids limit with independent terminal proof", receive: "valid", terminalProof: true, mutate: func(u *systemdUnit, fs *fakeFS) {
			u.snapshotMu.Lock()
			u.snapshot.PIDsEvents["max"] = 1
			u.snapshotMu.Unlock()
			fs.files[cgroupFile(pinned, "pids.events")] = []byte("max 1\n")
		}, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeCrash, wantError: ErrEncrypted},
		{name: "rejects nonexact final status", receive: "valid", finalErr: errors.New(private), termination: "empty", wantReason: "already-gone-terminal-unit-properties-unavailable"},
		{name: "rejects nonexclusive cgroup", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "nonexclusive", wantReason: "already-gone-termination-unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := newFakeSystemBus()
			fs := newFakeFS()
			u := &systemdUnit{name: "crux-anydoc-ack-witness.service", bus: bus, fs: fs, now: immediateClock{}}
			active, err := u.Report(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			u.spec = ServiceSpec{runtimeTreeDigest: active.RuntimeTreeDigest, MemoryMax: active.MemoryMax, MemorySwapMax: active.MemorySwapMax, TasksMax: active.TasksMax, CPUQuotaPercent: active.CPUQuotaPercent, CPUQuotaPeriodUSec: active.CPUQuotaPeriodUSec, RuntimeMax: active.RuntimeMax, KillMode: active.KillMode, ProtectSystem: active.ProtectSystem, CPUAccounting: active.CPUAccounting, NoNewPrivileges: active.NoNewPrivileges, PrivateNetwork: active.PrivateNetwork, PrivateTmp: active.PrivateTmp, ProtectHome: active.ProtectHome, ReadOnlyPaths: active.ReadOnlyPaths, InaccessiblePaths: active.InaccessiblePaths, BindReadOnlyPaths: active.BindReadOnlyPaths, ReadWritePaths: active.ReadWritePaths, RestrictAddressFamilies: active.RestrictAddressFamilies}
			if !verify(context.Background(), &verifiedLifecycleSystemdUnit{systemdUnit: u}, u.spec) {
				t.Fatal("production verification lifecycle rejected fake unit")
			}
			staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
			if err != nil {
				t.Fatal(err)
			}
			read, write, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer read.Close()
			defer write.Close()
			request := validTestRequest(FormatDOCX)
			run := &Run{unit: u, nonce: request.Nonce, digest: request.RequestDigest, sourceSHA: request.SourceSHA256, format: request.Format, limits: request.Limits, write: write, staged: staged, stop: make(chan struct{}), finished: make(chan struct{}), started: time.Now()}
			var received Result
			var receiveErr error
			if test.receive != "" {
				path := t.TempDir() + "/result.sock"
				listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
				if err != nil {
					t.Fatal(err)
				}
				u.resultListener, u.resultSocket, u.peers = listener, path, fakePeer{pid: active.MainPID}
				if test.receive == "ack-write" {
					u.writeResultACK = func(*net.UnixConn) error { return errors.New("ACK failed") }
				}
				done := make(chan error, 1)
				go func() {
					conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
					if err == nil {
						result := validWireResult(request)
						if test.receive == "valid" {
							result = Result{Request: request, FailureKind: FailureParser, Error: ErrEncrypted}
						}
						if test.receive == "mismatch" {
							result.Request.Nonce = strings.Repeat("b", 32)
							result.Request.RequestDigest = requestDigest(result.Request.Version, result.Request.Nonce, result.Request.Format, result.Request.SourceSHA256, result.Request.SourceBytes, result.Request.Limits)
						}
						err = EncodeResult(conn, result)
						if err == nil && test.receive == "valid" {
							ack := make([]byte, 4)
							_, err = io.ReadFull(conn, ack)
							if err == nil && string(ack) != "ACK\n" {
								err = errors.New("ACK missing")
							}
						}
						_ = conn.Close()
					}
					done <- err
				}()
				received, receiveErr = run.ReceiveResult(context.Background())
				if err := <-done; err != nil {
					t.Fatalf("result client = %v", err)
				}
			}
			if test.mutate != nil {
				test.mutate(u, fs)
			}
			if test.terminalProof {
				for key, value := range strict {
					bus.values[key] = value
				}
				if _, err := u.TerminalStatus(context.Background()); err != nil {
					t.Fatalf("independent terminal status = %v", err)
				}
			}
			bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
			bus.killErr = errors.New("kill " + private)
			bus.propGoneOnceAfterStop = true
			bus.propErrAfterGoneOnce = test.finalErr
			bus.valuesAfterFirstStopProperties = strict
			bus.onStop = func() {
				fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 0\n")
				fs.files[cgroupFile(pinned, "cgroup.procs")] = []byte{}
				if test.termination == "absent" {
					delete(fs.files, cgroupFile(pinned, "cgroup.events"))
					delete(fs.files, cgroupFile(pinned, "cgroup.procs"))
				}
				if test.termination == "nonexclusive" {
					fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 1\n")
				}
			}
			finishErr := run.Finish(context.Background(), receiveErr)
			terminal := run.TerminalReport()
			if terminal.Cleaned != test.wantClean {
				t.Fatalf("terminal report = %#v, want cleaned=%t", terminal, test.wantClean)
			}
			if test.wantClean {
				if errorCode(finishErr) != test.wantError || terminal.Workload.Code != test.wantOutcome || terminal.Cleanup.Accepted != test.wantClean || terminal.Cleaned != test.wantClean || terminal.PreStop.ControlGroup != pinned || terminal.Termination.Empty == terminal.Termination.Absent {
					t.Fatalf("accepted ACK witness lifecycle = %#v err=%v", terminal, finishErr)
				}
				if test.validation != "" {
					var validation *ResultValidationError
					if !errors.As(finishErr, &validation) || validation.Stage != test.validation {
						t.Fatalf("Finish() lost %s ResultValidationError: %T %v", test.validation, finishErr, finishErr)
					}
				} else if received.FailureKind != FailureParser || received.Error != ErrEncrypted {
					t.Fatalf("received parser failure = %#v", received)
				}
				return
			}
			if test.wantSafe != "" {
				if got := safeExecutionFailure(finishErr, terminal); got != test.wantSafe {
					t.Fatalf("safe diagnostic = %q, want %q", got, test.wantSafe)
				}
				return
			}
			want := "error=containment-unavailable outcome=containment-unavailable service=success stage=containment-cleanup reason=" + test.wantReason + " oom-killed=false pids-limited=false"
			if got := safeExecutionFailure(finishErr, terminal); got != want || strings.Contains(got, private) || strings.Contains(got, pinned) {
				t.Fatalf("safe diagnostic = %q, want %q without raw detail", got, want)
			}
		})
	}
}

func TestRunFinishTerminalRuntimeDisappearingLifecycle(t *testing.T) {
	const pinned = "/crux.slice/test"
	const private = "/private/final-status-detail"
	strict := map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "success", "ExecMainStatus": int32(0)}

	for _, runtime := range []struct {
		name                     string
		procFS                   ProcRuntimeFS
		unverifiedSnapshotReason string
	}{
		{name: "runtime target missing", unverifiedSnapshotReason: "terminal-accounting-report-runtime-attestation-runtime-target-missing"},
		{name: "runtime tree unreadable", procFS: unreadableRuntimeTreeFS(), unverifiedSnapshotReason: "terminal-accounting-report-runtime-attestation-runtime-tree-unreadable"},
	} {
		for _, test := range []struct {
			name        string
			receive     string
			peerErr     error
			final       map[string]any
			finalErr    error
			resetErr    error
			termination string
			procFS      ProcRuntimeFS
			mutate      func(*systemdUnit, *fakeFS)
			witness     func(*systemdUnit)
			wantReason  string
			wantService string
			wantClean   bool
			wantSafe    string
			wantPrior   *ContainmentError
			wantCleanup bool
			wantOutcome WorkloadOutcomeCode
			wantError   ErrorCode
		}{
			{name: "accepts exact get unit gone with empty cgroup", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeSuccess, wantError: OutcomeSuccess},
			{name: "accepts exact get unit gone with absent cgroup", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "absent", wantClean: true, wantOutcome: WorkloadOutcomeSuccess, wantError: OutcomeSuccess},
			{name: "rejects no witness", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantReason: "runtime-target-missing-ack-witness-absent", wantCleanup: true},
			{name: "accepts failed status with truthful crash outcome", receive: "valid", final: map[string]any{"ActiveState": "failed", "MainPID": uint32(0), "Result": "exit-code", "ExecMainStatus": int32(0)}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeCrash, wantError: ErrWorkerCrash},
			{name: "accepts failed status with witness and reset no such unit", receive: "valid", final: map[string]any{"ActiveState": "failed", "MainPID": uint32(0), "Result": "exit-code", "ExecMainStatus": int32(0)}, resetErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit"}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeCrash, wantError: ErrWorkerCrash},
			{name: "accepts oom with truthful OOM outcome", receive: "valid", final: map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "oom", "ExecMainStatus": int32(0)}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeOOM, wantError: ErrWorkerCrash},
			{name: "accepts oom kill with truthful OOM outcome", receive: "valid", final: map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "oom-kill", "ExecMainStatus": int32(0)}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeOOM, wantError: ErrWorkerCrash},
			{name: "accepts nonzero exit with truthful crash outcome", receive: "valid", final: map[string]any{"ActiveState": "inactive", "MainPID": uint32(0), "Result": "success", "ExecMainStatus": int32(76)}, termination: "empty", wantClean: true, wantOutcome: WorkloadOutcomeCrash, wantError: ErrWorkerCrash},
			{name: "rejects live status", receive: "valid", final: map[string]any{"ActiveState": "active", "MainPID": uint32(42), "Result": "success", "ExecMainStatus": int32(0)}, termination: "empty", wantReason: "runtime-target-missing-terminal-status-not-success"},
			{name: "rejects arbitrary final error", receive: "valid", finalErr: errors.New(private), termination: "empty", wantReason: "runtime-target-missing-terminal-status-unit-properties-unavailable"},
			{name: "rejects unrecognized final error", receive: "valid", finalErr: dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied", Body: []any{private}}, termination: "empty", wantReason: "runtime-target-missing-terminal-status-unit-properties-unrecognized"},
			{name: "nonexclusive termination evidence unavailable", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "nonexclusive", wantReason: "runtime-target-missing-termination-unavailable"},
			{name: "cgroup mismatch evidence unavailable", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "mismatch", wantReason: "runtime-target-missing-termination-unavailable"},
			{name: "rejects runtime mismatch", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", mutate: func(u *systemdUnit, _ *fakeFS) {
				u.snapshotMu.Lock()
				u.snapshot.RuntimeTreeDigest = "stale"
				u.snapshotMu.Unlock()
			}, wantReason: "runtime-target-missing-snapshot-runtime-digest-mismatch"},
			{name: "rejects unsafe runtime tree", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", procFS: unsafeRuntimeTreeFS(), wantReason: "terminal-accounting-report-runtime-attestation-runtime-tree-unsafe", wantService: "unknown"},
			{name: "rejects witness cgroup mismatch", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", witness: func(u *systemdUnit) { u.lifecycleWitness.cgroup = "/other" }, wantReason: "runtime-target-missing-ack-witness-cgroup-mismatch"},
			{name: "rejects witness pid", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", witness: func(u *systemdUnit) { u.lifecycleWitness.pid = 0 }, wantReason: "runtime-target-missing-ack-witness-pid-invalid"},
			{name: "rejects missing witness digest", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", witness: func(u *systemdUnit) { u.lifecycleWitness.requestDigest = "" }, wantReason: "runtime-target-missing-ack-witness-request-digest-missing"},
			{name: "rejects missing witness nonce", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", witness: func(u *systemdUnit) { u.lifecycleWitness.nonce = "" }, wantReason: "runtime-target-missing-ack-witness-nonce-missing"},
			{name: "rejects unverified snapshot", receive: "valid", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", mutate: func(u *systemdUnit, _ *fakeFS) { u.snapshotMu.Lock(); u.snapshotOK = false; u.snapshotMu.Unlock() }, wantReason: runtime.unverifiedSnapshotReason, wantService: "unknown"},
			{name: "rejects mismatched result witness", receive: "mismatch", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantSafe: "error=invalid-result outcome=containment-unavailable service=success stage=request-binding reason=mismatch oom-killed=false pids-limited=false"},
			{name: "rejects result ACK write failure", receive: "ack-write", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantSafe: "error=invalid-result outcome=containment-unavailable service=success stage=ack-write reason=io oom-killed=false pids-limited=false"},
			{name: "rejects unauthenticated result peer", receive: "peer-auth", finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantSafe: "error=containment-unavailable outcome=containment-unavailable service=success stage=authorize-peer-credentials reason=io-or-systemd oom-killed=false pids-limited=false", wantPrior: &ContainmentError{Stage: "authorize-peer-credentials", ReasonCode: "io-or-systemd"}},
			{name: "retains allowlisted no such unit peer diagnostic", receive: "peer-auth", peerErr: dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []any{private}}, finalErr: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, termination: "empty", wantSafe: "error=containment-unavailable outcome=containment-unavailable service=success stage=authorize-peer-credentials reason=dbus-no-such-unit oom-killed=false pids-limited=false", wantPrior: &ContainmentError{Stage: "authorize-peer-credentials", ReasonCode: "dbus-no-such-unit"}},
		} {
			t.Run(runtime.name+"/"+test.name, func(t *testing.T) {
				bus := newFakeSystemBus()
				fs := newFakeFS()
				u := &systemdUnit{name: "crux-anydoc-runtime-target.service", bus: bus, fs: fs, now: immediateClock{}}
				active, err := u.Report(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				u.spec = ServiceSpec{runtimeTreeDigest: active.RuntimeTreeDigest, MemoryMax: active.MemoryMax, MemorySwapMax: active.MemorySwapMax, TasksMax: active.TasksMax, CPUQuotaPercent: active.CPUQuotaPercent, CPUQuotaPeriodUSec: active.CPUQuotaPeriodUSec, RuntimeMax: active.RuntimeMax, KillMode: active.KillMode, ProtectSystem: active.ProtectSystem, CPUAccounting: active.CPUAccounting, NoNewPrivileges: active.NoNewPrivileges, PrivateNetwork: active.PrivateNetwork, PrivateTmp: active.PrivateTmp, ProtectHome: active.ProtectHome, ReadOnlyPaths: active.ReadOnlyPaths, InaccessiblePaths: active.InaccessiblePaths, BindReadOnlyPaths: active.BindReadOnlyPaths, ReadWritePaths: active.ReadWritePaths, RestrictAddressFamilies: active.RestrictAddressFamilies}
				if !verify(context.Background(), &verifiedLifecycleSystemdUnit{systemdUnit: u}, u.spec) {
					t.Fatal("production verification lifecycle rejected fake unit")
				}

				staged, err := NewStager(t.TempDir()).Stage([]byte("x"), 1)
				if err != nil {
					t.Fatal(err)
				}
				read, write, err := os.Pipe()
				if err != nil {
					t.Fatal(err)
				}
				defer read.Close()
				defer write.Close()
				request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}
				request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
				run := &Run{unit: u, nonce: request.Nonce, digest: request.RequestDigest, sourceSHA: request.SourceSHA256, format: request.Format, limits: request.Limits, write: write, staged: staged, stop: make(chan struct{}), finished: make(chan struct{}), started: time.Now()}
				var receiveErr error
				if test.receive != "" {
					path := t.TempDir() + "/result.sock"
					listener, listenErr := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
					if listenErr != nil {
						t.Fatal(listenErr)
					}
					peer := fakePeer{pid: 42}
					if test.receive == "peer-auth" {
						peer.err = test.peerErr
						if peer.err == nil {
							peer.err = errors.New("peer credentials unavailable")
						}
					}
					u.resultListener, u.resultSocket, u.peers = listener, path, peer
					if test.receive == "ack-write" {
						u.writeResultACK = func(*net.UnixConn) error { return errors.New("injected ACK write failure") }
					}
					ack := make(chan error, 1)
					go func() {
						conn, dialErr := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
						if dialErr == nil {
							result := validWireResult(request)
							if test.receive == "mismatch" {
								result.Request.Nonce = strings.Repeat("b", 32)
								result.Request.RequestDigest = requestDigest(result.Request.Version, result.Request.Nonce, result.Request.Format, result.Request.SourceSHA256, result.Request.SourceBytes, result.Request.Limits)
							}
							dialErr = EncodeResult(conn, result)
						}
						if dialErr == nil && test.receive == "valid" {
							got := make([]byte, 4)
							if _, readErr := io.ReadFull(conn, got); readErr != nil || string(got) != "ACK\n" {
								dialErr = errors.New("ack missing")
							}
						}
						if conn != nil {
							_ = conn.Close()
						}
						ack <- dialErr
					}()
					var receiveCtx context.Context = context.Background()
					cancelReceive := func() {}
					if test.receive == "peer-auth" {
						receiveCtx, cancelReceive = context.WithTimeout(context.Background(), 50*time.Millisecond)
					}
					_, receiveErr = run.ReceiveResult(receiveCtx)
					cancelReceive()
					if test.receive == "valid" && receiveErr != nil {
						t.Fatalf("ReceiveResult() = %v", receiveErr)
					}
					if test.receive == "mismatch" || test.receive == "ack-write" {
						var validation *ResultValidationError
						if !errors.As(receiveErr, &validation) {
							t.Fatalf("ReceiveResult() = %T %v, want result validation", receiveErr, receiveErr)
						}
						wantStage := "request-binding"
						if test.receive == "ack-write" {
							wantStage = "ack-write"
						}
						if validation.Stage != wantStage {
							t.Fatalf("result validation stage = %q, want %q", validation.Stage, wantStage)
						}
					}
					if test.wantPrior != nil {
						var containment *ContainmentError
						if !errors.As(receiveErr, &containment) || containment.Stage != test.wantPrior.Stage || containment.ReasonCode != test.wantPrior.ReasonCode {
							t.Fatalf("ReceiveResult() = %T %v, want containment %#v", receiveErr, receiveErr, test.wantPrior)
						}
					}
					if test.receive != "peer-auth" {
						if ackErr := <-ack; ackErr != nil {
							t.Fatalf("result ACK = %v", ackErr)
						}
					}
					if test.receive != "valid" {
						if _, ok := u.lastLifecycleWitness(); ok {
							t.Fatal("failed result receive minted an ACK witness")
						}
					}
				}

				if test.mutate != nil {
					test.mutate(u, fs)
				}
				if test.witness != nil {
					u.snapshotMu.Lock()
					test.witness(u)
					u.snapshotMu.Unlock()
				}
				u.procFS = procRuntimeFSFunc{lstat: func(path string) (os.FileInfo, error) {
					if strings.HasSuffix(path, "/root") {
						return fakeRuntimeInfo{mode: os.ModeSymlink | 0o777}, nil
					}
					return nil, os.ErrNotExist
				}}
				if test.procFS != nil {
					u.procFS = test.procFS
				} else if runtime.procFS != nil {
					u.procFS = runtime.procFS
				}
				bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
				bus.resetErr = test.resetErr
				bus.killErr = errors.New("kill " + private)
				bus.propGoneOnceAfterStop = true
				bus.propErrAfterGoneOnce = test.finalErr
				bus.valuesAfterFirstStopProperties = strict
				if test.final != nil {
					bus.valuesAfterFirstStopProperties = test.final
				}
				if test.name == "rejects live status" {
					// Let WaitInactive observe a finished unit, then ensure the final
					// TerminalStatus that validates runtime-target disappearance sees
					// the contradictory live status.
					bus.postStopProperties = []fakeSystemBusProperties{
						{values: strict},
						{values: test.final},
					}
				}
				bus.onStop = func() {
					fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 0\n")
					fs.files[cgroupFile(pinned, "cgroup.procs")] = []byte{}
					switch test.termination {
					case "absent":
						delete(fs.files, cgroupFile(pinned, "cgroup.events"))
						delete(fs.files, cgroupFile(pinned, "cgroup.procs"))
					case "nonexclusive":
						fs.files[cgroupFile(pinned, "cgroup.events")] = []byte("populated 1\n")
					case "mismatch":
						u.reportMu.Lock()
						u.controlGroup = "/crux.slice/other"
						u.reportMu.Unlock()
					}
				}

				finishErr := run.Finish(context.Background(), receiveErr)
				terminal := run.TerminalReport()
				if terminal.Cleaned != test.wantClean {
					t.Fatalf("terminal report = %#v, want cleaned=%t", terminal, test.wantClean)
				}
				if test.wantClean {
					if errorCode(finishErr) != test.wantError || terminal.Workload.Code != test.wantOutcome || !terminal.Cleanup.Accepted || !terminal.Cleaned || terminal.PreStop.ControlGroup != pinned || terminal.Termination.ControlGroup != pinned || terminal.Termination.Empty == terminal.Termination.Absent {
						t.Fatalf("accepted runtime-target evidence = %#v err=%v", terminal, finishErr)
					}
					return
				}
				if test.wantSafe != "" {
					if got := safeExecutionFailure(finishErr, terminal); got != test.wantSafe || strings.Contains(got, private) || strings.Contains(got, pinned) {
						t.Fatalf("safe diagnostic = %q, want %q without raw detail", got, test.wantSafe)
					}
					return
				}
				if test.wantCleanup {
					validation, containment := preCleanupDiagnostic(finishErr)
					if validation != nil || containment == nil || containment.ReasonCode != test.wantReason {
						t.Fatalf("pure missing witness diagnostic = validation:%#v containment:%#v", validation, containment)
					}
				}
				service := test.wantService
				if service == "" {
					service = "success"
				}
				want := "error=containment-unavailable outcome=containment-unavailable service=" + service + " stage=containment-cleanup reason=" + test.wantReason + " oom-killed=false pids-limited=false"
				if got := safeExecutionFailure(finishErr, terminal); got != want || strings.Contains(got, private) || strings.Contains(got, pinned) {
					t.Fatalf("safe diagnostic = %q, want %q without raw detail", got, want)
				}
			})
		}
	}
}

func TestTerminalStatusFromPropsAcceptsOnlyExactWireTypes(t *testing.T) {
	valid := map[string]any{"ActiveState": "inactive", "Result": "success", "MainPID": uint32(0), "ExecMainStatus": int32(0)}
	if _, ok := terminalStatusFromProps(valid); !ok {
		t.Fatal("exact systemd wire types must decode")
	}
	for _, test := range []struct {
		name  string
		props map[string]any
	}{
		{name: "negative ExecMainStatus", props: map[string]any{"ActiveState": "inactive", "Result": "success", "MainPID": uint32(0), "ExecMainStatus": int32(-1)}},
		{name: "wrong ExecMainStatus type", props: map[string]any{"ActiveState": "inactive", "Result": "success", "MainPID": uint32(0), "ExecMainStatus": uint32(0)}},
		{name: "overflow MainPID representation", props: map[string]any{"ActiveState": "inactive", "Result": "success", "MainPID": uint64(^uint32(0)) + 1, "ExecMainStatus": int32(0)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, ok := terminalStatusFromProps(test.props); ok {
				t.Fatal("invalid terminal status wire representation decoded")
			}
		})
	}
}

func TestCleanupEmitsTerminalOperationContainmentReasons(t *testing.T) {
	private := "/private/dbus-body-secret"
	for _, test := range []struct {
		name   string
		status error
		want   string
	}{
		{name: "get unit gone", status: &terminalStatusOperationError{stage: terminalStatusGetUnit, dbusClass: terminalStatusDBusGone}, want: "already-gone-terminal-get-unit-gone"},
		{name: "unit properties unrecognized", status: &terminalStatusOperationError{stage: terminalStatusUnitProperties, dbusClass: terminalStatusDBusUnrecognized}, want: "already-gone-terminal-unit-properties-unrecognized"},
		{name: "service properties unavailable", status: &terminalStatusOperationError{stage: terminalStatusServiceProperties, dbusClass: terminalStatusDBusGeneric}, want: "already-gone-terminal-service-properties-unavailable"},
		{name: "decode unavailable", status: &terminalStatusOperationError{stage: terminalStatusDecode, dbusClass: terminalStatusDBusGeneric}, want: "already-gone-terminal-decode-unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			unit := &fakeUnit{
				rep:     SandboxReport{ControlGroup: "/safe"},
				stopErr: &alreadyGoneError{proof: TerminalStatus{State: "inactive", ServiceResult: "success"}, cgroup: "/safe"},
				terminalStatus: func(context.Context) (TerminalStatus, error) {
					return TerminalStatus{}, test.status
				},
				termination: func(context.Context, string) (TerminationEvidence, error) {
					return TerminationEvidence{ControlGroup: "/safe", Empty: true}, nil
				},
			}
			_, _, _, reason := cleanup(unit)
			final := chainContainment(nil, false, "containment-cleanup", reason)
			var containment *ContainmentError
			if !errors.As(final, &containment) || containment.ReasonCode != test.want || !validContainmentReason(containment.ReasonCode) {
				t.Fatalf("final ContainmentError = %#v, want reason %q", containment, test.want)
			}
			if strings.Contains(containment.Error(), private) {
				t.Fatalf("final ContainmentError leaked private detail: %q", containment)
			}
		})
	}
}

type dbusHelperSystemBus struct {
	*fakeSystemBus
	unitProperties func(context.Context, string) (map[string]any, error)
}

func (b *dbusHelperSystemBus) UnitProperties(ctx context.Context, name string) (map[string]any, error) {
	if b.unitProperties != nil {
		return b.unitProperties(ctx, name)
	}
	return b.fakeSystemBus.UnitProperties(ctx, name)
}

func dbusUnitPropertiesError(err error) func(context.Context, string) (map[string]any, error) {
	return func(ctx context.Context, name string) (map[string]any, error) {
		object := &fakeDBusObject{calls: []*dbus.Call{{Err: err}}}
		return dbusUnitProperties(ctx, object, func(dbus.ObjectPath) dbus.BusObject {
			return object
		}, name)
	}
}

type fakeDBusObject struct {
	calls []*dbus.Call
}

func (o *fakeDBusObject) nextCall() *dbus.Call {
	call := o.calls[0]
	o.calls = o.calls[1:]
	return call
}

func (o *fakeDBusObject) Call(string, dbus.Flags, ...any) *dbus.Call { return o.nextCall() }
func (o *fakeDBusObject) CallWithContext(context.Context, string, dbus.Flags, ...any) *dbus.Call {
	return o.nextCall()
}
func (o *fakeDBusObject) Go(string, dbus.Flags, chan *dbus.Call, ...any) *dbus.Call {
	return o.nextCall()
}
func (o *fakeDBusObject) GoWithContext(context.Context, string, dbus.Flags, chan *dbus.Call, ...any) *dbus.Call {
	return o.nextCall()
}
func (*fakeDBusObject) AddMatchSignal(string, string, ...dbus.MatchOption) *dbus.Call {
	return &dbus.Call{}
}
func (*fakeDBusObject) RemoveMatchSignal(string, string, ...dbus.MatchOption) *dbus.Call {
	return &dbus.Call{}
}
func (*fakeDBusObject) GetProperty(string) (dbus.Variant, error) { return dbus.Variant{}, nil }
func (*fakeDBusObject) StoreProperty(string, any) error          { return nil }
func (*fakeDBusObject) SetProperty(string, any) error            { return nil }
func (*fakeDBusObject) Destination() string                      { return systemdService }
func (*fakeDBusObject) Path() dbus.ObjectPath                    { return "/" }

func prepareAlreadyGoneCleanup(t *testing.T, terminal map[string]any) (*systemdUnit, *fakeSystemBus) {
	t.Helper()
	bus := newFakeSystemBus()
	fs := newFakeFS()
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := u.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	u.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := u.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := u.CPUUsage(context.Background()); err != nil {
		t.Fatal(err)
	}
	u.MarkSnapshotVerified()
	// Stop carries a strict proof; the later terminal lookup must still reject
	// the supplied contradictory status.
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	bus.values["ExecMainStatus"] = int32(0)
	bus.valuesAfterFirstStopProperties = terminal
	bus.onStop = func() {
		for path := range fs.files {
			if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
				delete(fs.files, path)
			}
		}
	}
	return u, bus
}

func TestCleanupRejectsAlreadyGoneWhenFailedState(t *testing.T) {
	u, _ := prepareAlreadyGoneCleanup(t, map[string]any{
		"ActiveState":    "failed",
		"MainPID":        uint32(0),
		"Result":         "exit-code",
		"ExecMainStatus": int32(1),
	})
	_, _, _, reason := cleanup(u)
	if reason != "already-gone-terminal-not-success" {
		t.Fatalf("expected already-gone-terminal-not-success when terminal is failed, got %q", reason)
	}
}

func TestCleanupRejectsAlreadyGoneWhenOOMKillResult(t *testing.T) {
	u, _ := prepareAlreadyGoneCleanup(t, map[string]any{
		"ActiveState":    "inactive",
		"MainPID":        uint32(0),
		"Result":         "oom-kill",
		"ExecMainStatus": int32(0),
	})
	_, _, _, reason := cleanup(u)
	if reason != "already-gone-terminal-not-success" {
		t.Fatalf("expected already-gone-terminal-not-success when Result is oom-kill, got %q", reason)
	}
}

func TestCleanupRejectsAlreadyGoneWhenNonzeroExecMainStatus(t *testing.T) {
	u, _ := prepareAlreadyGoneCleanup(t, map[string]any{
		"ActiveState":    "inactive",
		"MainPID":        uint32(0),
		"Result":         "success",
		"ExecMainStatus": int32(76),
	})
	_, _, _, reason := cleanup(u)
	if reason != "already-gone-terminal-not-success" {
		t.Fatalf("expected already-gone-terminal-not-success when ExecMainStatus nonzero, got %q", reason)
	}
}

func TestCleanupRejectsAlreadyGoneWhenTerminationCgroupMismatchesPinnedCgroup(t *testing.T) {
	success := TerminalStatus{State: "inactive", ServiceResult: "success"}
	unit := &fakeUnit{
		rep:     SandboxReport{ControlGroup: "/pinned"},
		stopErr: &alreadyGoneError{proof: success, cgroup: "/pinned"},
		terminalStatus: func(context.Context) (TerminalStatus, error) {
			return success, nil
		},
		termination: func(context.Context, string) (TerminationEvidence, error) {
			return TerminationEvidence{ControlGroup: "/other", Absent: true}, nil
		},
	}

	_, _, _, reason := cleanup(unit)
	if reason != "already-gone-termination-mismatch" {
		t.Fatalf("expected already-gone-termination-mismatch, got %q", reason)
	}
}

func TestCleanupRejectsAlreadyGoneWhenTerminationUnproved(t *testing.T) {
	// Cgroup still populated: Absent/Empty termination evidence is unproved.
	bus := newFakeSystemBus()
	fs := newFakeFS()
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := u.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	u.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := u.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := u.CPUUsage(context.Background()); err != nil {
		t.Fatal(err)
	}
	u.MarkSnapshotVerified()
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	_, _, _, reason := cleanup(u)
	if reason != "already-gone-termination-unavailable" {
		t.Fatalf("expected already-gone-termination-unavailable when termination evidence is unavailable, got %q", reason)
	}
}

func TestCleanupReportsWaitInactiveWhenSystemdStatusCannotBeRead(t *testing.T) {
	// Stop cannot obtain carried terminal proof and WaitInactive cannot read status.
	bus := newFakeSystemBus()
	fs := newFakeFS()
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	first, err := u.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	u.spec.runtimeTreeDigest = first.RuntimeTreeDigest
	if _, err := u.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := u.CPUUsage(context.Background()); err != nil {
		t.Fatal(err)
	}
	u.MarkSnapshotVerified()
	bus.onStop = func() {
		for path := range fs.files {
			if strings.HasPrefix(path, "/sys/fs/cgroup/crux.slice/test/") {
				delete(fs.files, path)
			}
		}
	}
	bus.stopDBusErrorName = "org.freedesktop.systemd1.NoSuchUnit"
	// propErrAfterStop prevents Stop from obtaining carried proof; KillUnit
	// fallback succeeds; WaitInactive then cannot read status.
	bus.propErrAfterStop = true
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	_, _, _, reason := cleanup(u)
	if reason != "wait-inactive" {
		t.Fatalf("expected wait-inactive when systemd status cannot be read, got %q", reason)
	}
}

func TestStopFallsBackToKillOnUnknownStopError(t *testing.T) {
	bus := newFakeSystemBus()
	bus.stopErr = errors.New("denied")
	bus.killErr = errors.New("denied")
	fs := newFakeFS()
	u := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	err := u.Stop(context.Background())
	if err != nil {
		t.Fatalf("expected cgroup.kill fallback to succeed, got %v", err)
	}
	if string(fs.writes[cgroupFile("/crux.slice/test", "cgroup.kill")]) != "1" {
		t.Fatal("cgroup.kill fallback not used for unknown stop error")
	}
}
