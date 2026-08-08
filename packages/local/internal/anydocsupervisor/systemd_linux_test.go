//go:build linux

package anydocsupervisor

import (
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
		"ProtectHome":             true,
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
	if !ok || len(start) != 1 || start[0].Path != spec.Command[0] || len(start[0].Args) != 4 || start[0].Args[0] != start[0].Path || start[0].Args[1] != spec.Command[1] || start[0].Args[2] != got["ReadOnlyPaths"].([]string)[0] || start[0].Args[3] != got["ReadOnlyPaths"].([]string)[1] {
		t.Fatalf("unsafe ExecStart %#v", got["ExecStart"])
	}
	paths := got["ReadOnlyPaths"].([]string)
	if len(paths) != 2 || !strings.HasPrefix(paths[0], tmp+"/.a-") || !strings.HasPrefix(paths[1], tmp+"/.r-") {
		t.Fatalf("socket bind paths %#v", paths)
	}
	if !same(got["BindReadOnlyPaths"].([]string), []string{runtime + ":" + runtimeTarget, input + ":" + stagedSourceTarget}) {
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

func TestSystemdReportReadsActualCgroupLimitsAndRejectsMismatch(t *testing.T) {
	bus := newFakeSystemBus()
	fs := newFakeFS()
	unit := &systemdUnit{name: "crux-anydoc-test.service", bus: bus, fs: fs, now: immediateClock{}}
	report, err := unit.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report.MemoryMax != MemoryCeiling || report.MemoryCurrent != 1024 || report.MemoryEvents["oom_kill"] != 0 || report.MemorySwapMax != 0 || report.TasksMax != TasksCeiling || report.CPUQuotaPercent != CPUQuotaPercent || report.CPUQuotaPeriodUSec != CPUPeriodUSec || !contains(report.ControlGroupMembers, report.MainPID) {
		t.Fatalf("unexpected report %#v", report)
	}
	fs.files[cgroupFile("/crux.slice/test", "cpu.max")] = []byte("max 1000000\n")
	if _, err := unit.Report(context.Background()); err == nil {
		t.Fatal("unbounded CPU was accepted")
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
		done <- u.AuthorizeCapability(ctx, Request{Version: 1, Nonce: strings.Repeat("a", 32), RequestDigest: strings.Repeat("b", 64), SourceSHA256: strings.Repeat("c", 64), Format: "docx", Limits: JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}})
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
	done := make(chan struct {
		result Result
		err    error
	}, 1)
	request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: "docx", Limits: JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}}
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
	if err := EncodeResult(conn, Result{Request: request, OK: true, Payload: []byte("ok"), Accounting: &ResultAccounting{}}); err != nil {
		t.Fatal(err)
	}
	ack := make([]byte, 4)
	if _, err := io.ReadFull(conn, ack); err != nil || string(ack) != "ACK\n" {
		t.Fatalf("ack = %q, %v", ack, err)
	}
	_ = conn.Close()
	got := <-done
	if got.err != nil || string(got.result.Payload) != "ok" {
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
	expected := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: "docx", Limits: JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}}
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
	if err := EncodeResult(conn, Result{Request: mismatched, OK: true, Payload: []byte("ok"), Accounting: &ResultAccounting{}}); err != nil {
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
	reset                      bool
}

func newFakeSystemBus() *fakeSystemBus {
	return &fakeSystemBus{fdOK: true, values: map[string]any{"ActiveState": "active", "MainPID": uint32(42), "UID": uint32(1000), "DynamicUser": true, "PrivateUsers": true, "ProtectProc": "invisible", "ProcSubset": "pid", "ControlGroup": "/crux.slice/test", "RuntimeMaxUSec": uint64(RuntimeCeiling / time.Microsecond), "KillMode": "control-group", "ProtectSystem": "strict", "CPUAccounting": true, "NoNewPrivileges": true, "PrivateNetwork": true, "PrivateTmp": true, "ProtectHome": true, "CapabilityBoundingSet": uint64(0), "AmbientCapabilities": uint64(0), "ReadOnlyPaths": []string{"/run/anydoc/runtime"}, "BindReadOnlyPaths": []string{"/run/anydoc/input/source:" + stagedSourceTarget}, "ReadWritePaths": []string{"/run/anydoc/private"}, "RestrictAddressFamilies": restrictAddressFamilies{Allow: true, Families: []string{"AF_UNIX"}}}}
}
func (b *fakeSystemBus) SupportsUnixFDs() bool { return b.fdOK }
func (b *fakeSystemBus) StartTransientUnit(_ context.Context, name string, props []DBusProperty) error {
	b.name, b.properties = name, props
	values := propertiesByName(props)
	b.values["ReadOnlyPaths"] = values["ReadOnlyPaths"]
	b.values["BindReadOnlyPaths"] = values["BindReadOnlyPaths"]
	b.values["ReadWritePaths"] = values["ReadWritePaths"]
	b.values["RestrictAddressFamilies"] = values["RestrictAddressFamilies"]
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
	return &fakeFS{files: map[string][]byte{cgroupFile("/crux.slice/test", "memory.max"): []byte("536870912\n"), cgroupFile("/crux.slice/test", "memory.current"): []byte("1024\n"), cgroupFile("/crux.slice/test", "memory.events"): []byte("low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n"), cgroupFile("/crux.slice/test", "memory.swap.max"): []byte("0\n"), cgroupFile("/crux.slice/test", "pids.max"): []byte("64\n"), cgroupFile("/crux.slice/test", "cpu.max"): []byte("600000 1000000\n"), cgroupFile("/crux.slice/test", "cgroup.procs"): []byte("42\n43\n"), cgroupFile("/crux.slice/test", "cgroup.events"): []byte("populated 1\n"), cgroupFile("/crux.slice/test", "cpu.stat"): []byte("usage_usec 11\n")}, writes: map[string][]byte{}, removed: map[string]bool{}}
}
func (f *fakeFS) ReadFile(path string) ([]byte, error) {
	if strings.HasSuffix(path, "/.complete") {
		return []byte{}, nil
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
