//go:build linux

package anydocsupervisor

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

func TestSystemdStartUsesExactContainmentPropertiesAndClosesLocalFD(t *testing.T) {
	bus := newFakeSystemBus()
	backend := NewSystemdBackendWith(SystemdBackendOptions{Bus: bus, FileSystem: newFakeFS(), Clock: immediateClock{}})
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer write.Close()
	spec, err := NewServiceSpec("/run/anydoc/input", "/run/anydoc/runtime", "/run/anydoc/private", Limits{})
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
		"CapabilityBoundingSet":   []string{},
		"PrivateNetwork":          true,
		"RestrictAddressFamilies": []string{"AF_UNIX"},
		"PrivateTmp":              true,
		"ProtectSystem":           "strict",
		"ProtectHome":             true,
		"ReadOnlyPaths":           []string{"/run/anydoc/input", "/run/anydoc/runtime"},
		"ReadWritePaths":          []string{"/run/anydoc/private"},
		"StandardInput":           "file",
		"Environment":             []string{"", "LANG=C", "PATH=/usr/bin:/bin"},
	}
	for name, value := range want {
		if !sameProperty(got[name], value) {
			t.Fatalf("%s = %#v, want %#v", name, got[name], value)
		}
	}
	fd, ok := got["StandardInputFileDescriptor"].(dbus.UnixFD)
	if !ok || fd < 0 {
		t.Fatalf("stdin FD = %#v", got["StandardInputFileDescriptor"])
	}
	start, ok := got["ExecStart"].([]execStart)
	if !ok || len(start) != 1 || start[0].Path != "/usr/lib/crux/anydoc-runner" || len(start[0].Args) != 1 || start[0].Args[0] != start[0].Path {
		t.Fatalf("unsafe ExecStart %#v", got["ExecStart"])
	}
}

func TestSystemdBackendFailsClosedForUnavailablePermissionAndCanceledContexts(t *testing.T) {
	spec, _ := NewServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
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

func TestSystemdReportReadsActualCgroupLimitsAndRejectsMismatch(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	report, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report.MemoryMax != MemoryCeiling || report.MemorySwapMax != 0 || report.TasksMax != TasksCeiling || report.CPUQuotaPercent != CPUQuotaPercent || report.CPUQuotaPeriodUSec != CPUPeriodUSec || !contains(report.ControlGroupMembers, report.MainPID) {
		t.Fatalf("unexpected report %#v", report)
	}
	fs.files[cgroupFile("/crux.slice/test", "cpu.max")] = []byte("max 1000000\n")
	if _, err := unit.Report(context.Background()); err == nil {
		t.Fatal("unbounded CPU was accepted")
	}
}

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
	if err := u.WaitInactive(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := u.Cleanup(context.Background()); err != nil || !fs.removed["/run/anydoc/private"] || !bus.reset {
		t.Fatalf("cleanup err=%v removed=%v reset=%v", err, fs.removed, bus.reset)
	}
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
	spec, _ := NewServiceSpec("/run/input", "/run/runtime", "/run/private", Limits{})
	spec.ReadWritePaths = []string{"/run/../private"}
	if validBackendSpec(spec) {
		t.Fatal("accepted unsafe backend spec")
	}
}

type fakeSystemBus struct {
	fdOK                       bool
	name                       string
	properties                 []DBusProperty
	values                     map[string]any
	startErr, stopErr, killErr error
	reset                      bool
}

func newFakeSystemBus() *fakeSystemBus {
	return &fakeSystemBus{fdOK: true, values: map[string]any{"ActiveState": "active", "MainPID": uint32(42), "ControlGroup": "/crux.slice/test", "RuntimeMaxUSec": uint64(RuntimeCeiling / time.Microsecond), "KillMode": "control-group", "ProtectSystem": "strict", "CPUAccounting": true, "NoNewPrivileges": true, "PrivateNetwork": true, "PrivateTmp": true, "ProtectHome": true, "CapabilityBoundingSet": []string{}, "ReadOnlyPaths": []string{"/run/anydoc/input", "/run/anydoc/runtime"}, "ReadWritePaths": []string{"/run/anydoc/private"}, "RestrictAddressFamilies": []string{"AF_UNIX"}}}
}
func (b *fakeSystemBus) SupportsUnixFDs() bool { return b.fdOK }
func (b *fakeSystemBus) StartTransientUnit(_ context.Context, name string, props []DBusProperty) error {
	b.name, b.properties = name, props
	return b.startErr
}
func (b *fakeSystemBus) UnitProperties(_ context.Context, _ string) (map[string]any, error) {
	return b.values, nil
}
func (b *fakeSystemBus) StopUnit(_ context.Context, _ string) error { return b.stopErr }
func (b *fakeSystemBus) KillUnit(_ context.Context, _ string) error { return b.killErr }
func (b *fakeSystemBus) ResetFailedUnit(_ context.Context, _ string) error {
	b.reset = true
	return nil
}

type fakeFS struct {
	files   map[string][]byte
	writes  map[string][]byte
	removed map[string]bool
}

func newFakeFS() *fakeFS {
	return &fakeFS{files: map[string][]byte{cgroupFile("/crux.slice/test", "memory.max"): []byte("536870912\n"), cgroupFile("/crux.slice/test", "memory.swap.max"): []byte("0\n"), cgroupFile("/crux.slice/test", "pids.max"): []byte("64\n"), cgroupFile("/crux.slice/test", "cpu.max"): []byte("600000 1000000\n"), cgroupFile("/crux.slice/test", "cgroup.procs"): []byte("42\n43\n"), cgroupFile("/crux.slice/test", "cgroup.events"): []byte("populated 1\n"), cgroupFile("/crux.slice/test", "cpu.stat"): []byte("usage_usec 11\n")}, writes: map[string][]byte{}, removed: map[string]bool{}}
}
func (f *fakeFS) ReadFile(path string) ([]byte, error) {
	v, ok := f.files[path]
	if !ok {
		return nil, os.ErrNotExist
	}
	return v, nil
}
func (f *fakeFS) WriteFile(path string, contents []byte) error {
	f.writes[path] = append([]byte(nil), contents...)
	return nil
}
func (f *fakeFS) RemoveAll(path string) error { f.removed[path] = true; return nil }

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
