//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
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

func TestSystemdReportRejectsMalformedBindAndProtectHomeProperties(t *testing.T) {
	for _, test := range []struct {
		name  string
		key   string
		value any
	}{
		{name: "legacy bind string array", key: "BindReadOnlyPaths", value: []string{"/source:/target"}},
		{name: "bind ignores missing", key: "BindReadOnlyPaths", value: []any{[]any{"/source", "/target", true, uint64(0)}}},
		{name: "bind mount flags", key: "BindReadOnlyPaths", value: []any{[]any{"/source", "/target", false, uint64(1)}}},
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

func TestCleanupUsesVerifiedSnapshotWhenCgroupVanishesOnExit(t *testing.T) {
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
	if reason != "accounting-evidence" {
		t.Fatalf("cleanup reason = %q, want accounting-evidence for malformed-present data", reason)
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
func (f rootedProcFS) Lstat(path string) (os.FileInfo, error)     { return os.Lstat(f.path(path)) }
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

func TestSystemdResultAcceptsOnlyExactWorkerAndAcknowledges(t *testing.T) {
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
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("socket retained: %v", err)
	}
}

func TestSystemdResultRejectsMismatchedCapabilityBeforeAcknowledging(t *testing.T) {
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

func TestSystemdResultHasExactlyOneReceiver(t *testing.T) {
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

type fakePeer struct{ pid int }

func (p fakePeer) Credentials(*net.UnixConn) (int, uint32, error) { return p.pid, 1000, nil }

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

type fakeSystemBus struct {
	fdOK                       bool
	name                       string
	properties                 []DBusProperty
	values                     map[string]any
	startErr, stopErr, killErr error
	propErr                    error
	propErrAfterStop           bool
	// propGoneOnceAfterStop returns a typed properties-gone error on the first
	// UnitProperties call after StopUnit, then serves values again so terminal
	// proof can be asserted independently of stop confirmation.
	propGoneOnceAfterStop bool
	propGoneConsumed      bool
	// propGoneAfterStop confirms a successful terminal status once, then
	// simulates systemd unloading the transient unit before cleanup can poll.
	propGoneAfterStop              bool
	propertiesAfterStop            int
	valuesAfterFirstStopProperties map[string]any
	stopped                        bool
	stopDBusErrorName              string
	reset                          bool
	onStop                         func()
}

func newFakeSystemBus() *fakeSystemBus {
	return &fakeSystemBus{fdOK: true, values: map[string]any{"ActiveState": "active", "MainPID": uint32(42), "UID": uint32(1000), "DynamicUser": true, "PrivateUsers": true, "ProtectProc": "invisible", "ProcSubset": "pid", "ControlGroup": "/crux.slice/test", "RuntimeMaxUSec": uint64(RuntimeCeiling / time.Microsecond), "KillMode": "control-group", "ProtectSystem": "strict", "CPUAccounting": true, "NoNewPrivileges": true, "PrivateNetwork": true, "PrivateTmp": true, "ProtectHome": "yes", "CapabilityBoundingSet": uint64(0), "AmbientCapabilities": uint64(0), "ReadOnlyPaths": []string{"/run/anydoc/runtime"}, "BindReadOnlyPaths": []any{[]any{"/run/anydoc/input/source", stagedSourceTarget, false, uint64(0)}}, "ReadWritePaths": []string{"/run/anydoc/private"}, "RestrictAddressFamilies": restrictAddressFamilies{Allow: true, Families: []string{"AF_UNIX"}}}}
}
func (b *fakeSystemBus) SupportsUnixFDs() bool { return b.fdOK }
func (b *fakeSystemBus) StartTransientUnit(_ context.Context, name string, props []DBusProperty) error {
	b.name, b.properties = name, props
	values := propertiesByName(props)
	b.values["ReadOnlyPaths"] = values["ReadOnlyPaths"]
	b.values["InaccessiblePaths"] = values["InaccessiblePaths"]
	b.values["BindReadOnlyPaths"] = values["BindReadOnlyPaths"]
	b.values["ReadWritePaths"] = values["ReadWritePaths"]
	b.values["RestrictAddressFamilies"] = values["RestrictAddressFamilies"]
	return b.startErr
}
func (b *fakeSystemBus) UnitProperties(_ context.Context, _ string) (map[string]any, error) {
	if b.propErr != nil {
		return nil, b.propErr
	}
	if b.propErrAfterStop && b.stopped {
		return nil, dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject", Body: []interface{}{}}
	}
	if b.propGoneOnceAfterStop && b.stopped && !b.propGoneConsumed {
		b.propGoneConsumed = true
		return nil, dbus.Error{Name: "org.freedesktop.systemd1.NoSuchUnit", Body: []interface{}{}}
	}
	if b.propGoneAfterStop && b.stopped {
		b.propertiesAfterStop++
		if b.propertiesAfterStop > 1 {
			return nil, dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject", Body: []interface{}{}}
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
	return nil
}

type fakeFS struct {
	files      map[string][]byte
	writes     map[string][]byte
	writeErr   error
	removed    map[string]bool
	reads      map[string]int
	failReadAt map[string]int
}

func newFakeFS() *fakeFS {
	return &fakeFS{files: map[string][]byte{cgroupFile("/crux.slice/test", "memory.max"): []byte("536870912\n"), cgroupFile("/crux.slice/test", "memory.current"): []byte("1024\n"), cgroupFile("/crux.slice/test", "memory.peak"): []byte("2048\n"), cgroupFile("/crux.slice/test", "memory.events"): []byte("low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n"), cgroupFile("/crux.slice/test", "memory.swap.max"): []byte("0\n"), cgroupFile("/crux.slice/test", "pids.max"): []byte("32\n"), cgroupFile("/crux.slice/test", "pids.events"): []byte("max 0\n"), cgroupFile("/crux.slice/test", "cpu.max"): []byte("600000 1000000\n"), cgroupFile("/crux.slice/test", "cgroup.procs"): []byte("42\n43\n"), cgroupFile("/crux.slice/test", "cgroup.events"): []byte("populated 1\n"), cgroupFile("/crux.slice/test", "cpu.stat"): []byte("usage_usec 11\nnr_periods 1\nnr_throttled 0\nthrottled_usec 0\n")}, writes: map[string][]byte{}, removed: map[string]bool{}, reads: map[string]int{}, failReadAt: map[string]int{}}
}
func (f *fakeFS) ReadFile(path string) ([]byte, error) {
	if strings.HasSuffix(path, "/.complete") {
		return []byte{}, nil
	}
	f.reads[path]++
	if failAt := f.failReadAt[path]; failAt > 0 && f.reads[path] >= failAt {
		return nil, os.ErrNotExist
	}
	v, ok := f.files[path]
	if !ok {
		return nil, os.ErrNotExist
	}
	return v, nil
}
func (f *fakeFS) Lstat(path string) (os.FileInfo, error) {
	if strings.HasSuffix(path, runtimeTarget) {
		return fakeRuntimeInfo{name: "runtime", mode: os.ModeDir | 0o555}, nil
	}
	if strings.HasSuffix(path, runtimeTarget+"/.complete") {
		return fakeRuntimeInfo{name: ".complete", mode: 0o444}, nil
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
func (f *fakeFS) RemoveAll(path string) error     { f.removed[path] = true; return nil }
func (f *fakeFS) Chown(string, int, int) error    { return nil }
func (f *fakeFS) Chmod(string, os.FileMode) error { return nil }

type fakeRuntimeInfo struct {
	name string
	mode os.FileMode
}

func (i fakeRuntimeInfo) Name() string       { return i.name }
func (i fakeRuntimeInfo) Size() int64        { return 0 }
func (i fakeRuntimeInfo) Mode() os.FileMode  { return i.mode }
func (i fakeRuntimeInfo) ModTime() time.Time { return time.Time{} }
func (i fakeRuntimeInfo) IsDir() bool        { return i.mode.IsDir() }
func (i fakeRuntimeInfo) Sys() any           { return nil }

type fakeRuntimeEntry struct{ fakeRuntimeInfo }

func (e fakeRuntimeEntry) Type() os.FileMode          { return e.mode.Type() }
func (e fakeRuntimeEntry) Info() (os.FileInfo, error) { return e.fakeRuntimeInfo, nil }

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
	err := u.Stop(context.Background())
	var alreadyGone *alreadyGoneError
	if !errors.As(err, &alreadyGone) || !successfulInactiveTerminal(alreadyGone.proof.State, alreadyGone.proof.MainPID, alreadyGone.proof.ServiceResult, alreadyGone.proof.ExecMainStatus) {
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
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	bus.values["ExecMainStatus"] = int32(0)
	bus.propGoneAfterStop = true
	_, _, _, reason := cleanup(u)
	if reason != "" {
		t.Fatalf("expected empty reason, got %q", reason)
	}
}

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

func TestCleanupRejectsAlreadyGoneWhenAbsentCgroupButNoTerminal(t *testing.T) {
	// Absent cgroup alone is insufficient without retained inactive terminal status.
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
	// After stop confirmation via inactive properties, drop terminal query so
	// cleanup cannot retain successful inactive terminal evidence.
	bus.propErrAfterStop = true
	bus.values["ActiveState"] = "inactive"
	bus.values["MainPID"] = uint32(0)
	bus.values["Result"] = "success"
	_, _, _, reason := cleanup(u)
	if reason != "already-gone-terminal-unavailable" {
		t.Fatalf("expected already-gone-terminal-unavailable when terminal evidence missing, got %q", reason)
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
