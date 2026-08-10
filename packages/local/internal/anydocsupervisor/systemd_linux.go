//go:build linux

package anydocsupervisor

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"golang.org/x/sys/unix"
)

const systemdService = "org.freedesktop.systemd1"

// ContainmentError exposes only a stable stage and reason code. It is safe for
// the env-gated integration gate to log without leaking host paths or input.
type ContainmentError struct{ Stage, ReasonCode string }

func (e *ContainmentError) Error() string { return "containment " + e.Stage + ":" + e.ReasonCode }
func containment(stage string, err error) error {
	return &ContainmentError{Stage: stage, ReasonCode: containmentReason(err)}
}

type unitAlreadyGone struct{}

func (unitAlreadyGone) Error() string { return "unit already gone" }

var errUnitAlreadyGone = unitAlreadyGone{}

// stopFailure carries only a fixed diagnostic reason. It deliberately omits
// D-Bus bodies, unit names, and cgroup paths because cleanup diagnostics may
// be exposed outside the local host.
type stopFailure struct{ reason string }

func (e *stopFailure) Error() string { return "unit stop unavailable: " + e.reason }

func stopUnitFailureReason(err error) string {
	var dbusErr dbus.Error
	if !errors.As(err, &dbusErr) {
		return "stop-unit-dbus-other"
	}
	switch dbusErr.Name {
	case "org.freedesktop.DBus.Error.InvalidArgs":
		return "stop-unit-dbus-invalid-args"
	case "org.freedesktop.DBus.Error.AccessDenied":
		return "stop-unit-dbus-access-denied"
	case "org.freedesktop.systemd1.NoSuchUnit":
		return "stop-unit-dbus-no-such-unit"
	default:
		return "stop-unit-dbus-other"
	}
}

// D-Bus missing-unit classification is operation-specific:
//   - Manager.StopUnit: only org.freedesktop.systemd1.NoSuchUnit
//   - UnitProperties follow-up: NoSuchUnit or org.freedesktop.DBus.Error.UnknownObject
//
// UnknownObject from StopUnit must remain a failure (unit path may still exist).
func isDbusStopNoSuchUnit(err error) bool {
	var dbusErr dbus.Error
	if !errors.As(err, &dbusErr) {
		return false
	}
	return dbusErr.Name == "org.freedesktop.systemd1.NoSuchUnit"
}

func isDbusUnitPropertiesGone(err error) bool {
	var dbusErr dbus.Error
	if !errors.As(err, &dbusErr) {
		return false
	}
	switch dbusErr.Name {
	case "org.freedesktop.systemd1.NoSuchUnit", "org.freedesktop.DBus.Error.UnknownObject":
		return true
	default:
		return false
	}
}

// successfulInactiveTerminal is the strict proof that an already-gone unit
// may count as successful cleanup: MainPID 0, inactive only, Result success,
// ExecMainStatus 0. failed/oom-kill/exit-code/nonzero never qualifies.
func successfulInactiveTerminal(state string, mainPID int, serviceResult string, execMainStatus int) bool {
	return mainPID == 0 && state == "inactive" && serviceResult == "success" && execMainStatus == 0
}

func successfulInactiveFromProps(p map[string]any) bool {
	return successfulInactiveTerminal(
		stringValue(p, "ActiveState"),
		intValue(p, "MainPID"),
		stringValue(p, "Result"),
		intValue(p, "ExecMainStatus"),
	)
}

func containmentReason(err error) string {
	if err == nil {
		return "unknown"
	}
	var dbusErr dbus.Error
	if errors.As(err, &dbusErr) {
		switch dbusErr.Name {
		case "org.freedesktop.DBus.Error.InvalidArgs":
			return "dbus-invalid-args"
		case "org.freedesktop.DBus.Error.AccessDenied":
			return "dbus-access-denied"
		case "org.freedesktop.systemd1.NoSuchUnit":
			return "dbus-no-such-unit"
		default:
			return "dbus-other"
		}
	}
	if errors.Is(err, os.ErrDeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return "deadline"
	}
	return "io-or-systemd"
}

var blockedNodeEnvironment = []string{"NODE_OPTIONS", "NODE_PATH", "NAPI_RS_NATIVE_LIBRARY_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH"}

// DBusProperty is the deliberately small subset of a systemd transient-unit
// request that this package is permitted to make.
type DBusProperty struct {
	Name  string
	Value any
}

// SystemBus is injectable so the containment contract can be tested without a
// host system bus. Implementations must not expose arbitrary D-Bus calls.
type SystemBus interface {
	SupportsUnixFDs() bool
	StartTransientUnit(context.Context, string, []DBusProperty) error
	UnitProperties(context.Context, string) (map[string]any, error)
	StopUnit(context.Context, string) error
	KillUnit(context.Context, string) error
	ResetFailedUnit(context.Context, string) error
}

type FileSystem interface {
	ReadFile(string) ([]byte, error)
	WriteFile(string, []byte) error
	RemoveAll(string) error
	Chown(string, int, int) error
	Chmod(string, os.FileMode) error
}

type ProcRuntimeFS interface {
	Lstat(string) (os.FileInfo, error)
	ReadDir(string) ([]os.DirEntry, error)
	ReadFile(string) ([]byte, error)
}

type Clock interface {
	Now() time.Time
	After(time.Duration) <-chan time.Time
}

type systemClock struct{}

func (systemClock) Now() time.Time                         { return time.Now() }
func (systemClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

type SystemdBackendOptions struct {
	Bus           SystemBus
	FileSystem    FileSystem
	Clock         Clock
	SocketFactory SocketFactory
	PeerVerifier  PeerVerifier
	ProcRuntimeFS ProcRuntimeFS
}

type SocketFactory interface {
	Listen(string) (*net.UnixListener, error)
}
type PeerVerifier interface {
	Credentials(*net.UnixConn) (int, uint32, error)
}
type unixSocketFactory struct{}

func (unixSocketFactory) Listen(path string) (*net.UnixListener, error) {
	return net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
}

type unixPeerVerifier struct{}

func (unixPeerVerifier) Credentials(conn *net.UnixConn) (int, uint32, error) {
	var credential *unix.Ucred
	var err error
	raw, controlErr := conn.SyscallConn()
	if controlErr != nil {
		return 0, 0, controlErr
	}
	controlErr = raw.Control(func(fd uintptr) { credential, err = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED) })
	if controlErr != nil || err != nil || credential == nil || credential.Pid <= 0 {
		return 0, 0, errors.New("peer credentials unavailable")
	}
	return int(credential.Pid), credential.Uid, nil
}

type systemdBackend struct {
	bus     SystemBus
	fs      FileSystem
	now     Clock
	sockets SocketFactory
	peers   PeerVerifier
	procFS  ProcRuntimeFS
}

// NewSystemdBackend creates the Linux backend. It is intentionally not wired
// into Anydoc production routing; callers must opt in explicitly.
func NewSystemdBackend() Backend {
	conn, err := dbus.ConnectSystemBus()
	if err != nil {
		return &systemdBackend{}
	}
	return NewSystemdBackendWith(SystemdBackendOptions{Bus: &godbusSystemBus{conn: conn}, FileSystem: osFS{}, Clock: systemClock{}})
}

func NewSystemdBackendWith(options SystemdBackendOptions) Backend {
	fs := options.FileSystem
	if fs == nil {
		fs = osFS{}
	}
	clock := options.Clock
	if clock == nil {
		clock = systemClock{}
	}
	sockets := options.SocketFactory
	if sockets == nil {
		sockets = unixSocketFactory{}
	}
	peers := options.PeerVerifier
	if peers == nil {
		peers = unixPeerVerifier{}
	}
	procFS := options.ProcRuntimeFS
	if procFS == nil {
		if candidate, ok := fs.(ProcRuntimeFS); ok {
			procFS = candidate
		} else {
			procFS = osProcRuntimeFS{}
		}
	}
	return &systemdBackend{bus: options.Bus, fs: fs, now: clock, sockets: sockets, peers: peers, procFS: procFS}
}

func (b *systemdBackend) Start(ctx context.Context, spec ServiceSpec, stdin *os.File) (Unit, error) {
	if b == nil || b.bus == nil || b.fs == nil || b.now == nil || b.sockets == nil || b.peers == nil || stdin == nil || !validBackendSpec(spec) || ctx.Err() != nil {
		return nil, containment("preflight", errors.New("unavailable"))
	}
	name, err := transientUnitName()
	if err != nil {
		return nil, containment("transient-unit-name", err)
	}
	socketPath, listener, err := b.listen(spec, ".a-")
	if err != nil {
		return nil, containment("authorization-socket", err)
	}
	if err := b.fs.Chmod(socketPath, 0); err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		return nil, containment("authorization-socket-chmod", err)
	}
	resultPath, resultListener, err := b.listen(spec, ".r-")
	if err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		return nil, containment("result-socket", err)
	}
	if err := b.fs.Chmod(resultPath, 0); err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		_ = resultListener.Close()
		_ = os.Remove(resultPath)
		return nil, containment("result-socket-chmod", err)
	}
	defer func() {
		if listener != nil {
			_ = listener.Close()
			_ = os.Remove(socketPath)
		}
		if resultListener != nil {
			_ = resultListener.Close()
			_ = os.Remove(resultPath)
		}
	}()
	spec.BindReadOnlyPaths = append(
		spec.BindReadOnlyPaths,
		socketPath+":"+authorizationSocketTarget,
		resultPath+":"+resultSocketTarget,
	)
	properties := systemdProperties(spec)
	err = b.bus.StartTransientUnit(ctx, name, properties)
	closeErr := stdin.Close()
	if err != nil {
		return nil, containment("start-transient-unit", err)
	}
	if closeErr != nil {
		return nil, containment("close-stdin", closeErr)
	}
	u := &systemdUnit{name: name, bus: b.bus, fs: b.fs, procFS: b.procFS, now: b.now, tmp: onlyPrivateTemp(spec), listener: listener, socket: socketPath, resultListener: resultListener, resultSocket: resultPath, peers: b.peers, spec: spec}
	if err := u.waitActive(ctx); err != nil {
		_ = u.Stop(context.Background())
		_ = u.Cleanup(context.Background())
		return nil, containment("wait-active", err)
	}
	listener = nil
	resultListener = nil
	return u, nil
}

func (b *systemdBackend) listen(spec ServiceSpec, prefix string) (string, *net.UnixListener, error) {
	runtime := onlyPrivateTemp(spec)
	token, err := transientUnitName()
	if err != nil {
		return "", nil, err
	}
	id := strings.TrimSuffix(strings.TrimPrefix(token, "crux-anydoc-"), ".service")
	path := filepath.Join(runtime, prefix+id+".sock")
	if !validAbsolutePath(path) {
		return "", nil, errors.New("invalid socket path")
	}
	_ = os.Remove(path)
	listener, err := b.sockets.Listen(path)
	if err != nil {
		return "", nil, err
	}
	return path, listener, nil
}

func validBackendSpec(spec ServiceSpec) bool {
	if spec.probe == nil && (len(spec.Command) != 2 || !validAbsolutePath(spec.Command[0]) || !validAbsolutePath(spec.Command[1])) {
		return false
	}
	if spec.probe != nil && (!validAbsolutePath(spec.probe.hostExecutable) || len(spec.probe.executableSHA) != sha256.Size*2 || spec.probe.action == "" || spec.probe.resultPath == "") {
		return false
	}
	wantBinds := 2
	if spec.probe != nil {
		wantBinds = 3
	}
	if spec.NodeSHA256 == "" || len(spec.runtimeTreeDigest) != sha256.Size*2 || !same(spec.Environment, []string{"LANG=C", "PATH=/usr/bin:/bin"}) || len(spec.ReadOnlyPaths) != 0 || len(spec.BindReadOnlyPaths) != wantBinds || len(spec.ReadWritePaths) != 1 || !same(spec.InaccessiblePaths, []string{"/opt", "/srv", "/var/lib"}) || !same(spec.RestrictAddressFamilies, []string{"AF_UNIX"}) {
		return false
	}
	if spec.Command[1] != filepath.Join(runtimeTarget, "runner.mjs") {
		return false
	}
	paths := append(append([]string{}, spec.ReadOnlyPaths...), spec.ReadWritePaths...)
	for i, path := range paths {
		if !validAbsolutePath(path) {
			return false
		}
		for j, other := range paths {
			if i != j && (path == other || strings.HasPrefix(other, path+"/")) {
				return false
			}
		}
	}
	runtimeBind := strings.Split(spec.BindReadOnlyPaths[0], ":")
	sourceBind := strings.Split(spec.BindReadOnlyPaths[1], ":")
	if len(runtimeBind) != 2 || !validAbsolutePath(runtimeBind[0]) || runtimeBind[1] != runtimeTarget || len(sourceBind) != 2 || !validAbsolutePath(sourceBind[0]) || sourceBind[1] != stagedSourceTarget {
		return false
	}
	if spec.probe != nil {
		probeBind := strings.Split(spec.BindReadOnlyPaths[2], ":")
		if len(probeBind) != 2 || probeBind[0] != spec.probe.hostExecutable || probeBind[1] != probeTarget {
			return false
		}
	}
	return spec.MemoryMax > 0 && spec.MemorySwapMax == 0 && spec.TasksMax > 0 && spec.CPUQuotaPercent > 0 && spec.CPUQuotaPeriodUSec == CPUPeriodUSec && spec.RuntimeMax > 0 && spec.KillMode == "control-group" && spec.ProtectSystem == "strict" && spec.CPUAccounting && spec.NoNewPrivileges && spec.PrivateNetwork && spec.PrivateTmp && spec.ProtectHome
}

func transientUnitName() (string, error) {
	var token [12]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	return "crux-anydoc-" + hex.EncodeToString(token[:]) + ".service", nil
}

type execStart struct {
	Path string
	Args []string
	Fail bool
}

type restrictAddressFamilies struct {
	Allow    bool
	Families []string
}

const (
	authorizationSocketTarget = "/run/crux-anydoc/authorize.sock"
	resultSocketTarget        = "/run/crux-anydoc/result.sock"
)

// bindReadOnlyPath matches systemd's a(ssbt) BindReadOnlyPaths wire contract.
type bindReadOnlyPath struct {
	Source        string
	Destination   string
	IgnoreMissing bool
	MountFlags    uint64
}

func bindReadOnlyPathProperties(paths []string) []bindReadOnlyPath {
	result := make([]bindReadOnlyPath, 0, len(paths))
	for _, path := range paths {
		parts := strings.SplitN(path, ":", 2)
		result = append(result, bindReadOnlyPath{Source: parts[0], Destination: parts[1]})
	}
	return result
}

func systemdProperties(spec ServiceSpec) []DBusProperty {
	sockets := []string{authorizationSocketTarget, resultSocketTarget}
	command := []execStart{{Path: spec.Command[0], Args: append(append([]string{}, spec.Command...), sockets...), Fail: false}}
	if spec.probe != nil {
		command = []execStart{{Path: probeTarget, Args: append([]string{probeTarget, "-test.run=^TestContainmentProbeProcess$", "--", spec.probe.action, spec.probe.resultPath}, sockets...), Fail: false}}
	}
	return []DBusProperty{
		{"Description", "Crux Anydoc isolated runner"},
		{"Type", "exec"},
		{"ExecStart", command},
		{"Environment", spec.Environment},
		{"UnsetEnvironment", blockedNodeEnvironment},
		{"CPUAccounting", spec.CPUAccounting},
		{"CPUQuotaPerSecUSec", uint64(spec.CPUQuotaPercent * 10_000)},
		{"CPUQuotaPeriodUSec", uint64(spec.CPUQuotaPeriodUSec)},
		{"MemoryMax", uint64(spec.MemoryMax)},
		{"MemorySwapMax", uint64(spec.MemorySwapMax)},
		{"TasksMax", uint64(spec.TasksMax)},
		{"RuntimeMaxUSec", uint64(spec.RuntimeMax / time.Microsecond)},
		{"KillMode", spec.KillMode},
		{"NoNewPrivileges", spec.NoNewPrivileges},
		{"DynamicUser", true},
		{"PrivateUsers", true},
		{"ProtectProc", "invisible"},
		{"ProcSubset", "pid"},
		{"CapabilityBoundingSet", uint64(0)},
		{"AmbientCapabilities", uint64(0)},
		{"PrivateNetwork", spec.PrivateNetwork},
		{"RestrictAddressFamilies", restrictAddressFamilies{Allow: true, Families: spec.RestrictAddressFamilies}},
		{"PrivateTmp", spec.PrivateTmp},
		{"ProtectSystem", spec.ProtectSystem},
		{"ProtectHome", "yes"},
		{"ReadOnlyPaths", spec.ReadOnlyPaths},
		{"InaccessiblePaths", spec.InaccessiblePaths},
		{"BindReadOnlyPaths", bindReadOnlyPathProperties(spec.BindReadOnlyPaths)},
		{"ReadWritePaths", spec.ReadWritePaths},
	}
}

func (u *systemdUnit) VerifyAttestedProbe(ctx context.Context, want *containmentProbe) error {
	if want == nil || len(want.executableSHA) != sha256.Size*2 || ctx.Err() != nil {
		return errors.New("missing probe attestation")
	}
	p, err := u.bus.UnitProperties(ctx, u.name)
	if err != nil {
		return err
	}
	pid := intValue(p, "MainPID")
	if pid <= 0 {
		return errors.New("missing probe pid")
	}
	exe := filepath.Join("/proc", strconv.Itoa(pid), "exe")
	path, err := os.Readlink(exe)
	if err != nil || path != probeTarget {
		return errors.New("probe executable path mismatch")
	}
	bytes, err := os.ReadFile(exe)
	if err != nil {
		return errors.New("probe executable unavailable")
	}
	sum := sha256.Sum256(bytes)
	if hex.EncodeToString(sum[:]) != want.executableSHA {
		return errors.New("probe executable hash mismatch")
	}
	return nil
}

func onlyPrivateTemp(spec ServiceSpec) string {
	if len(spec.ReadWritePaths) != 1 || !validAbsolutePath(spec.ReadWritePaths[0]) {
		return ""
	}
	return spec.ReadWritePaths[0]
}

func validAbsolutePath(path string) bool {
	return filepath.IsAbs(path) && filepath.Clean(path) == path && path != "/"
}

type systemdUnit struct {
	name             string
	bus              SystemBus
	fs               FileSystem
	procFS           ProcRuntimeFS
	now              Clock
	tmp              string
	listener         *net.UnixListener
	socket           string
	resultListener   *net.UnixListener
	resultSocket     string
	resultMu         sync.Mutex
	resultClaimed    bool
	peers            PeerVerifier
	spec             ServiceSpec
	reportMu         sync.Mutex
	controlGroup     string
	terminalMu       sync.Mutex
	terminalProof    TerminalStatus
	hasTerminalProof bool
	snapshotMu       sync.Mutex
	snapshot         SandboxReport
	snapshotCPU      time.Duration
	snapshotSeen     bool
	snapshotOK       bool
}

func (u *systemdUnit) VerifiedServiceSpec(_ ServiceSpec) ServiceSpec { return u.spec }

func (u *systemdUnit) MarkSnapshotVerified() {
	u.snapshotMu.Lock()
	u.snapshotOK = u.snapshotSeen
	u.snapshotMu.Unlock()
}

func (u *systemdUnit) LastVerifiedSnapshot() (SandboxReport, time.Duration, bool) {
	u.snapshotMu.Lock()
	defer u.snapshotMu.Unlock()
	if !u.snapshotOK || !u.snapshotSeen {
		return SandboxReport{}, 0, false
	}
	return cloneSandboxReport(u.snapshot), u.snapshotCPU, true
}

// VerifyAttestedNode checks the kernel's executable reference after systemd has
// started the unit and before any capability frame is written.
func (u *systemdUnit) VerifyAttestedNode(ctx context.Context, want assets.AttestedNode) error {
	if want.Path() == "" || ctx.Err() != nil {
		return errors.New("missing Node attestation")
	}
	p, err := u.bus.UnitProperties(ctx, u.name)
	if err != nil {
		return err
	}
	pid := intValue(p, "MainPID")
	if pid <= 0 {
		return errors.New("missing worker pid")
	}
	path, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "exe"))
	if err != nil {
		return err
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil || path != want.Path() {
		return errors.New("worker executable swapped")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || uint64(stat.Dev) != want.Dev() || stat.Ino != want.Inode() {
		return errors.New("worker executable identity mismatch")
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(bytes)
	if hex.EncodeToString(sum[:]) != want.SHA256() {
		return errors.New("worker executable hash mismatch")
	}
	return nil
}

func (u *systemdUnit) waitActive(ctx context.Context) error {
	for {
		p, err := u.bus.UnitProperties(ctx, u.name)
		if err != nil {
			return err
		}
		if stringValue(p, "ActiveState") == "active" && intValue(p, "MainPID") > 0 {
			return nil
		}
		if stringValue(p, "ActiveState") == "failed" || stringValue(p, "ActiveState") == "inactive" {
			return errors.New("unit did not activate")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-u.now.After(10 * time.Millisecond):
		}
	}
}

func (u *systemdUnit) Report(ctx context.Context) (SandboxReport, error) {
	p, err := u.bus.UnitProperties(ctx, u.name)
	if err != nil {
		return SandboxReport{}, errors.New("unit properties unavailable")
	}
	cgroup := stringValue(p, "ControlGroup")
	if !validCgroup(cgroup) {
		return SandboxReport{}, errors.New("invalid cgroup")
	}
	u.reportMu.Lock()
	if u.controlGroup == "" {
		u.controlGroup = cgroup
	}
	matchedCgroup := u.controlGroup == cgroup
	u.reportMu.Unlock()
	if !matchedCgroup {
		return SandboxReport{}, errors.New("control group identity changed")
	}
	memory, err := cgroupLimit(u.fs, cgroup, "memory.max")
	if err != nil {
		return SandboxReport{}, err
	}
	memoryCurrent, err := cgroupLimit(u.fs, cgroup, "memory.current")
	if err != nil {
		return SandboxReport{}, err
	}
	memoryPeak, err := cgroupLimit(u.fs, cgroup, "memory.peak")
	if err != nil {
		return SandboxReport{}, err
	}
	memoryEvents, err := cgroupEvents(u.fs, cgroup, "memory.events")
	if err != nil {
		return SandboxReport{}, err
	}
	cpuStats, err := cgroupEvents(u.fs, cgroup, "cpu.stat")
	if err != nil {
		return SandboxReport{}, err
	}
	pidsEvents, err := cgroupEvents(u.fs, cgroup, "pids.events")
	if err != nil {
		return SandboxReport{}, err
	}
	swap, err := cgroupLimit(u.fs, cgroup, "memory.swap.max")
	if err != nil {
		return SandboxReport{}, err
	}
	tasks, err := cgroupLimit(u.fs, cgroup, "pids.max")
	if err != nil {
		return SandboxReport{}, err
	}
	quota, period, err := cpuLimit(u.fs, cgroup)
	if err != nil {
		return SandboxReport{}, err
	}
	members, err := cgroupPIDs(u.fs, cgroup)
	if err != nil {
		return SandboxReport{}, err
	}
	populated, err := cgroupPopulated(u.fs, cgroup)
	if err != nil {
		return SandboxReport{}, err
	}
	rafAllow, raf, ok := restrictAddressFamiliesValue(p["RestrictAddressFamilies"])
	binds, bindsOK := bindReadOnlyPathsValue(p["BindReadOnlyPaths"])
	protectHome, protectHomeOK := p["ProtectHome"].(string)
	if !ok || !bindsOK || !protectHomeOK || protectHome != "yes" || !uint64ValueOK(p, "CapabilityBoundingSet") || !uint64ValueOK(p, "AmbientCapabilities") {
		return SandboxReport{}, errors.New("invalid sandbox properties")
	}
	pid := intValue(p, "MainPID")
	runtimeDigest := ""
	if pid > 0 {
		procFS := u.procFS
		if procFS == nil {
			procFS, _ = u.fs.(ProcRuntimeFS)
		}
		runtimeDigest, err = mountedRuntimeDigest(procFS, pid)
		if err != nil {
			return SandboxReport{}, errors.New("mounted runtime attestation unavailable")
		}
	}
	report := SandboxReport{MainPID: pid, ControlGroup: cgroup, RuntimeTreeDigest: runtimeDigest, UID: uintValue(p, "UID"), DynamicUser: boolValue(p, "DynamicUser"), PrivateUsers: boolValue(p, "PrivateUsers"), ProtectProc: stringValue(p, "ProtectProc"), ProcSubset: stringValue(p, "ProcSubset"), ServiceResult: stringValue(p, "Result"), ExecMainStatus: intValue(p, "ExecMainStatus"), ControlGroupMembers: members, MemoryMax: memory, MemoryCurrent: memoryCurrent, MemoryPeak: memoryPeak, MemoryEvents: memoryEvents, CPUStats: cpuStats, PIDsEvents: pidsEvents, MemorySwapMax: swap, TasksMax: int(tasks), CPUQuotaPercent: int(quota * 100 / period), CPUQuotaPeriodUSec: int(period), RuntimeMax: time.Duration(uintValue(p, "RuntimeMaxUSec")) * time.Microsecond, KillMode: stringValue(p, "KillMode"), ProtectSystem: stringValue(p, "ProtectSystem"), CPUAccounting: boolValue(p, "CPUAccounting"), NoNewPrivileges: boolValue(p, "NoNewPrivileges"), PrivateNetwork: boolValue(p, "PrivateNetwork"), PrivateTmp: boolValue(p, "PrivateTmp"), ProtectHome: true, CapabilityBoundingSet: uintValue(p, "CapabilityBoundingSet"), AmbientCapabilities: uintValue(p, "AmbientCapabilities"), ReadOnlyPaths: stringsValue(p, "ReadOnlyPaths"), InaccessiblePaths: stringsValue(p, "InaccessiblePaths"), BindReadOnlyPaths: binds, ReadWritePaths: stringsValue(p, "ReadWritePaths"), RestrictAddressFamiliesAllow: rafAllow, RestrictAddressFamilies: raf, Populated: populated}
	// Candidate snapshots are only PID/runtime-attested. After verify() marks
	// the fully verified base, leave that base immutable for ENOENT reuse;
	// callers still receive this live report for peer authorization.
	if report.MainPID > 0 && report.RuntimeTreeDigest == u.spec.runtimeTreeDigest {
		u.snapshotMu.Lock()
		if !u.snapshotOK {
			u.snapshot = cloneSandboxReport(report)
			u.snapshotSeen = true
		}
		u.snapshotMu.Unlock()
	}
	return report, nil
}

func mountedRuntimeDigest(fs ProcRuntimeFS, pid int) (string, error) {
	if fs == nil || pid <= 0 {
		return "", errors.New("runtime filesystem unavailable")
	}
	root := filepath.Join("/proc", strconv.Itoa(pid), "root", strings.TrimPrefix(runtimeTarget, "/"))
	h := sha256.New()
	var walk func(string, string, bool) error
	walk = func(path, rel string, rootEntry bool) error {
		info, err := fs.Lstat(path)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe mounted runtime entry")
		}
		if info.IsDir() {
			want := os.FileMode(0o755)
			if rootEntry {
				want = 0o555
			}
			if info.Mode().Perm() != want {
				return errors.New("mounted runtime directory mode mismatch")
			}
			_, _ = fmt.Fprintf(h, "d\x00%s\x00%04o\x00", rel, info.Mode().Perm())
			entries, err := fs.ReadDir(path)
			if err != nil {
				return err
			}
			for _, entry := range entries {
				childRel := entry.Name()
				if rel != "." {
					childRel = rel + "/" + childRel
				}
				if err := walk(filepath.Join(path, entry.Name()), childRel, false); err != nil {
					return err
				}
			}
			return nil
		}
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0o444 {
			return errors.New("mounted runtime file mismatch")
		}
		contents, err := fs.ReadFile(path)
		if err != nil || int64(len(contents)) != info.Size() {
			return errors.New("mounted runtime file unavailable")
		}
		sum := sha256.Sum256(contents)
		_, _ = fmt.Fprintf(h, "f\x00%s\x00%04o\x00%d\x00%s\x00", rel, info.Mode().Perm(), info.Size(), hex.EncodeToString(sum[:]))
		return nil
	}
	if err := walk(root, ".", true); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (u *systemdUnit) AuthorizeCapability(ctx context.Context, request Request) error {
	if u.listener == nil || u.peers == nil {
		return errors.New("authorization unavailable")
	}
	defer func() {
		_ = u.listener.Close()
		u.listener = nil
		_ = os.Remove(u.socket)
	}()
	if deadline, ok := ctx.Deadline(); ok {
		_ = u.listener.SetDeadline(deadline)
	}
	lastStage := "authorize-accept"
	lastReason := "deadline"
	for {
		conn, err := u.listener.AcceptUnix()
		if err != nil {
			if errors.Is(err, os.ErrDeadlineExceeded) && lastStage != "authorize-accept" {
				return &ContainmentError{Stage: lastStage, ReasonCode: lastReason}
			}
			return containment("authorize-accept", err)
		}
		pid, uid, peerErr := u.peers.Credentials(conn)
		report, reportErr := u.Report(ctx)
		if peerErr == nil && reportErr == nil && pid == report.MainPID && uint64(uid) == report.UID && contains(report.ControlGroupMembers, pid) {
			if deadline, ok := ctx.Deadline(); ok {
				_ = conn.SetDeadline(deadline)
			}
			err = EncodeRequest(conn, request)
			_ = conn.Close()
			if err != nil {
				return containment("authorize-encode", err)
			}
			return nil
		}
		_ = conn.Close()
		if peerErr != nil {
			lastStage, lastReason = "authorize-peer-credentials", containmentReason(peerErr)
		} else if reportErr != nil {
			lastStage, lastReason = "authorize-report", containmentReason(reportErr)
		} else {
			lastStage, lastReason = "authorize-peer-identity", "peer-mismatch"
		}
		select {
		case <-ctx.Done():
			return &ContainmentError{Stage: lastStage, ReasonCode: lastReason}
		case <-u.now.After(10 * time.Millisecond):
		}
	}
}

func (u *systemdUnit) PrepareAuthorization(ctx context.Context) error {
	report, err := u.Report(ctx)
	if err != nil || !report.DynamicUser || report.UID == 0 || !report.PrivateUsers || report.ProtectProc != "invisible" || report.ProcSubset != "pid" {
		return errors.New("authorization unavailable")
	}
	if u.resultSocket == "" || u.resultListener == nil {
		return errors.New("authorization unavailable")
	}
	if u.tmp == "" || u.fs.Chown(u.tmp, int(report.UID), 0) != nil || u.fs.Chmod(u.tmp, 0o700) != nil {
		return errors.New("authorization unavailable")
	}
	if err := u.fs.Chown(u.socket, int(report.UID), 0); err != nil {
		return errors.New("authorization unavailable")
	}
	if err := u.fs.Chmod(u.socket, 0600); err != nil || u.fs.Chown(u.resultSocket, int(report.UID), 0) != nil || u.fs.Chmod(u.resultSocket, 0600) != nil {
		return errors.New("authorization unavailable")
	}
	return nil
}

func (u *systemdUnit) ReceiveResult(ctx context.Context, expected Request) (Result, error) {
	u.resultMu.Lock()
	if u.resultClaimed {
		u.resultMu.Unlock()
		return Result{}, closed(ErrReplay)
	}
	if u.resultListener == nil || u.peers == nil {
		u.resultMu.Unlock()
		return Result{}, closedWith(ErrContainmentUnavailable, &ContainmentError{Stage: "result-receive", ReasonCode: "unavailable"})
	}
	listener := u.resultListener
	u.resultListener = nil
	u.resultClaimed = true
	u.resultMu.Unlock()
	defer func() {
		_ = listener.Close()
		_ = os.Remove(u.resultSocket)
	}()
	stopCancel := context.AfterFunc(ctx, func() { _ = listener.SetDeadline(time.Now()) })
	defer stopCancel()
	for {
		deadline := time.Now().Add(100 * time.Millisecond)
		if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
			deadline = contextDeadline
		}
		_ = listener.SetDeadline(deadline)
		conn, err := listener.AcceptUnix()
		if err != nil {
			if ctx.Err() != nil {
				return Result{}, ctx.Err()
			}
			status, statusErr := u.TerminalStatus(ctx)
			if statusErr == nil && status.MainPID == 0 && (status.State == "inactive" || status.State == "failed") {
				return Result{}, closed(ErrWorkerCrash)
			}
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			return Result{}, closedWith(ErrContainmentUnavailable, &ContainmentError{Stage: "result-receive", ReasonCode: "io"})
		}
		pid, uid, peerErr := u.peers.Credentials(conn)
		report, reportErr := u.Report(ctx)
		if peerErr == nil && reportErr == nil && pid == report.MainPID && uint64(uid) == report.UID && contains(report.ControlGroupMembers, pid) {
			if deadline, ok := ctx.Deadline(); ok {
				_ = conn.SetDeadline(deadline)
			}
			result, decodeErr := DecodeResult(conn)
			if decodeErr != nil {
				var sup *SupervisorError
				if errors.As(decodeErr, &sup) && sup.Code == ErrInvalidFrame {
					decodeErr = resultValidation("decode/frame-json", "invalid-frame")
				} else {
					decodeErr = resultValidation("payload/validation", "invalid-result")
				}
			}
			if decodeErr == nil && result.Request != expected {
				decodeErr = resultValidation("request-binding", "mismatch")
			}
			if decodeErr == nil {
				_, err := u.RefreshAccounting(ctx)
				if err != nil {
					decodeErr = resultValidation("accounting-refresh", "unavailable")
				}
			}
			if decodeErr == nil {
				_, err := conn.Write([]byte("ACK\n"))
				if err != nil {
					decodeErr = resultValidation("ack-write", "io")
				}
			}
			_ = conn.Close()
			if decodeErr != nil {
				var validation *ResultValidationError
				if errors.As(decodeErr, &validation) {
					return Result{}, closedWith(ErrInvalidResult, decodeErr)
				}
				return Result{}, closedWith(ErrInvalidResult, resultValidation("decode/frame-json", "unknown"))
			}
			return result, nil
		}
		_ = conn.Close()
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-u.now.After(10 * time.Millisecond):
		}
	}
}

func (u *systemdUnit) CPUUsage(ctx context.Context) (time.Duration, error) {
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	p, err := u.bus.UnitProperties(ctx, u.name)
	if err != nil || !validCgroup(stringValue(p, "ControlGroup")) {
		return 0, errors.New("cpu accounting unavailable")
	}
	data, err := u.fs.ReadFile(cgroupFile(stringValue(p, "ControlGroup"), "cpu.stat"))
	if err != nil {
		return 0, errors.New("cpu accounting unavailable")
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "usage_usec" {
			v, err := strconv.ParseInt(fields[1], 10, 64)
			if err == nil && v >= 0 {
				usage := time.Duration(v) * time.Microsecond
				u.snapshotMu.Lock()
				u.snapshotCPU = usage
				u.snapshotMu.Unlock()
				return usage, nil
			}
		}
	}
	return 0, errors.New("cpu accounting unavailable")
}

func (u *systemdUnit) RefreshAccounting(ctx context.Context) (time.Duration, error) {
	if u == nil || u.fs == nil || ctx.Err() != nil {
		return 0, errors.New("accounting unavailable")
	}
	u.reportMu.Lock()
	cgroup := u.controlGroup
	u.reportMu.Unlock()
	if !validCgroup(cgroup) {
		return 0, errors.New("accounting unavailable")
	}
	memoryCurrent, err := cgroupLimit(u.fs, cgroup, "memory.current")
	if err != nil {
		return 0, err
	}
	memoryPeak, err := cgroupLimit(u.fs, cgroup, "memory.peak")
	if err != nil {
		return 0, err
	}
	memoryEvents, err := cgroupEvents(u.fs, cgroup, "memory.events")
	if err != nil {
		return 0, err
	}
	cpuStats, err := cgroupEvents(u.fs, cgroup, "cpu.stat")
	if err != nil {
		return 0, err
	}
	pidsEvents, err := cgroupEvents(u.fs, cgroup, "pids.events")
	if err != nil {
		return 0, err
	}
	members, err := cgroupPIDs(u.fs, cgroup)
	if err != nil {
		return 0, err
	}
	populated, err := cgroupPopulated(u.fs, cgroup)
	if err != nil {
		return 0, err
	}
	usageUsec, ok := cpuStats["usage_usec"]
	if !ok || usageUsec < 0 {
		return 0, errors.New("accounting unavailable")
	}
	usage := time.Duration(usageUsec) * time.Microsecond
	u.snapshotMu.Lock()
	if !u.snapshotOK || !u.snapshotSeen {
		u.snapshotMu.Unlock()
		return 0, errors.New("accounting snapshot is not verified")
	}
	// Only the last fully verify(...) base is refreshable, and only for the
	// exact retained cgroup identity. Sandbox property fields stay frozen;
	// accounting counters/maps may advance for ENOENT cleanup reuse.
	if u.snapshot.ControlGroup != cgroup {
		u.snapshotMu.Unlock()
		return 0, errors.New("accounting snapshot identity mismatch")
	}
	next := cloneSandboxReport(u.snapshot)
	next.MemoryCurrent = memoryCurrent
	next.MemoryPeak = memoryPeak
	next.MemoryEvents = memoryEvents
	next.CPUStats = cpuStats
	next.PIDsEvents = pidsEvents
	next.ControlGroupMembers = members
	next.Populated = populated
	u.snapshot = cloneSandboxReport(next)
	u.snapshotCPU = usage
	u.snapshotMu.Unlock()
	return usage, nil
}

func (u *systemdUnit) CaptureTerminalAccounting(ctx context.Context) (SandboxReport, time.Duration, accountingCaptureFailure, error) {
	report, reportErr := u.Report(ctx)
	if reportErr != nil {
		return SandboxReport{}, 0, u.captureFailure(), reportErr
	}
	cpu, cpuErr := u.CPUUsage(ctx)
	if cpuErr != nil {
		return SandboxReport{}, 0, u.captureFailure(), cpuErr
	}
	return report, cpu, accountingCaptureOK, nil
}

func (u *systemdUnit) captureFailure() accountingCaptureFailure {
	if u == nil || u.fs == nil {
		return accountingCaptureInvalid
	}
	u.reportMu.Lock()
	cgroup := u.controlGroup
	u.reportMu.Unlock()
	if !validCgroup(cgroup) {
		return accountingCaptureInvalid
	}
	_, err := u.fs.ReadFile(cgroupFile(cgroup, "cgroup.events"))
	if os.IsNotExist(err) {
		return accountingCaptureExactCgroupAbsent
	}
	return accountingCaptureInvalid
}

func (u *systemdUnit) Stop(ctx context.Context) error {
	stopErr := u.bus.StopUnit(ctx, u.name)
	if stopErr == nil {
		return nil
	}
	if stopUnitFailureReason(stopErr) == "stop-unit-dbus-no-such-unit" {
		// Confirm via typed UnitProperties gone, or strict successful-inactive
		// terminal proof. UnknownObject from StopUnit never enters this branch.
		// Arbitrary UnitProperties errors are not gone.
		p, propErr := u.bus.UnitProperties(ctx, u.name)
		if propErr != nil {
			if isDbusUnitPropertiesGone(propErr) {
				return errUnitAlreadyGone
			}
		} else if successfulInactiveFromProps(p) {
			u.recordTerminalProof(terminalStatusFromProps(p))
			return errUnitAlreadyGone
		}
	}
	if err := u.bus.KillUnit(ctx, u.name); err == nil {
		return nil
	}
	p, propErr := u.bus.UnitProperties(ctx, u.name)
	if propErr != nil {
		return &stopFailure{reason: "stop-dbus-other"}
	}
	cgroup := stringValue(p, "ControlGroup")
	if !validCgroup(cgroup) {
		return &stopFailure{reason: "stop-properties-invalid-cgroup"}
	}
	if err := u.fs.WriteFile(cgroupFile(cgroup, "cgroup.kill"), []byte("1")); err != nil {
		return &stopFailure{reason: "stop-cgroup-kill-unavailable"}
	}
	return nil
}

func (u *systemdUnit) WaitInactive(ctx context.Context) error {
	for {
		status, err := u.TerminalStatus(ctx)
		if err != nil {
			return errors.New("unit status unavailable")
		}
		if (status.State == "inactive" || status.State == "failed") && status.MainPID == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-u.now.After(10 * time.Millisecond):
		}
	}
}

func (u *systemdUnit) TerminalStatus(ctx context.Context) (TerminalStatus, error) {
	if u == nil || u.bus == nil || ctx.Err() != nil {
		return TerminalStatus{}, errors.New("unit status unavailable")
	}
	p, err := u.bus.UnitProperties(ctx, u.name)
	if err != nil {
		if isDbusUnitPropertiesGone(err) {
			if proof, ok := u.lastTerminalProof(); ok {
				return proof, nil
			}
		}
		return TerminalStatus{}, errors.New("unit status unavailable")
	}
	return terminalStatusFromProps(p), nil
}

func terminalStatusFromProps(p map[string]any) TerminalStatus {
	return TerminalStatus{
		MainPID:        intValue(p, "MainPID"),
		State:          stringValue(p, "ActiveState"),
		ServiceResult:  stringValue(p, "Result"),
		ExecMainStatus: intValue(p, "ExecMainStatus"),
	}
}

func (u *systemdUnit) recordTerminalProof(status TerminalStatus) {
	if !successfulInactiveTerminal(status.State, status.MainPID, status.ServiceResult, status.ExecMainStatus) {
		return
	}
	u.terminalMu.Lock()
	u.terminalProof = status
	u.hasTerminalProof = true
	u.terminalMu.Unlock()
}

func (u *systemdUnit) lastTerminalProof() (TerminalStatus, bool) {
	u.terminalMu.Lock()
	defer u.terminalMu.Unlock()
	return u.terminalProof, u.hasTerminalProof
}

func (u *systemdUnit) TerminationEvidence(_ context.Context, cgroup string) (TerminationEvidence, error) {
	if u == nil || u.fs == nil || !validCgroup(cgroup) {
		return TerminationEvidence{}, errors.New("termination evidence unavailable")
	}
	u.reportMu.Lock()
	matchedCgroup := u.controlGroup != "" && u.controlGroup == cgroup
	u.reportMu.Unlock()
	if !matchedCgroup {
		return TerminationEvidence{}, errors.New("termination cgroup identity mismatch")
	}
	events, err := u.fs.ReadFile(cgroupFile(cgroup, "cgroup.events"))
	if os.IsNotExist(err) {
		return TerminationEvidence{ControlGroup: cgroup, Absent: true}, nil
	}
	if err != nil || cgroupIsPopulated(events) {
		return TerminationEvidence{}, errors.New("original cgroup is not empty")
	}
	members, err := u.fs.ReadFile(cgroupFile(cgroup, "cgroup.procs"))
	if os.IsNotExist(err) {
		return TerminationEvidence{ControlGroup: cgroup, Absent: true}, nil
	}
	if err != nil || len(strings.Fields(string(members))) != 0 {
		return TerminationEvidence{}, errors.New("original cgroup is not empty")
	}
	return TerminationEvidence{ControlGroup: cgroup, Empty: true}, nil
}

func (u *systemdUnit) Cleanup(ctx context.Context) error {
	if u.listener != nil {
		_ = u.listener.Close()
		u.listener = nil
	}
	if u.socket != "" {
		_ = os.Remove(u.socket)
	}
	u.resultMu.Lock()
	resultListener := u.resultListener
	u.resultListener = nil
	u.resultMu.Unlock()
	if resultListener != nil {
		_ = resultListener.Close()
	}
	if u.resultSocket != "" {
		_ = os.Remove(u.resultSocket)
	}
	if err := u.bus.ResetFailedUnit(ctx, u.name); err != nil {
		return errors.New("unit cleanup unavailable")
	}
	if u.tmp != "" {
		if err := u.fs.RemoveAll(u.tmp); err != nil {
			return errors.New("private temp cleanup unavailable")
		}
	}
	return nil
}

type osFS struct{}

type osProcRuntimeFS struct{}

func (osProcRuntimeFS) Lstat(path string) (os.FileInfo, error)     { return os.Lstat(path) }
func (osProcRuntimeFS) ReadDir(path string) ([]os.DirEntry, error) { return os.ReadDir(path) }
func (osProcRuntimeFS) ReadFile(path string) ([]byte, error)       { return os.ReadFile(path) }

func (osFS) ReadFile(path string) ([]byte, error) { return os.ReadFile(path) }
func (osFS) WriteFile(path string, contents []byte) error {
	return os.WriteFile(path, contents, 0)
}
func (osFS) RemoveAll(path string) error               { return os.RemoveAll(path) }
func (osFS) Chown(path string, uid, gid int) error     { return os.Chown(path, uid, gid) }
func (osFS) Chmod(path string, mode os.FileMode) error { return os.Chmod(path, mode) }

func validCgroup(path string) bool {
	return strings.HasPrefix(path, "/") && filepath.Clean(path) == path && !strings.Contains(path, "..")
}
func cgroupFile(cgroup, file string) string { return filepath.Join("/sys/fs/cgroup", cgroup, file) }
func cgroupEvents(fs FileSystem, cgroup, file string) (map[string]int64, error) {
	b, err := fs.ReadFile(cgroupFile(cgroup, file))
	if err != nil {
		return nil, err
	}
	out := map[string]int64{}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) != 2 {
			continue
		}
		v, e := strconv.ParseInt(f[1], 10, 64)
		if e != nil || v < 0 {
			return nil, errors.New("invalid cgroup events")
		}
		out[f[0]] = v
	}
	return out, nil
}
func cgroupLimit(fs FileSystem, cgroup, file string) (int64, error) {
	b, err := fs.ReadFile(cgroupFile(cgroup, file))
	if err != nil {
		return 0, errors.New("cgroup unavailable")
	}
	v, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
	if err != nil || v < 0 {
		return 0, errors.New("invalid cgroup limit")
	}
	return v, nil
}
func cpuLimit(fs FileSystem, cgroup string) (int64, int64, error) {
	b, err := fs.ReadFile(cgroupFile(cgroup, "cpu.max"))
	if err != nil {
		return 0, 0, errors.New("cgroup unavailable")
	}
	f := strings.Fields(string(b))
	if len(f) != 2 || f[0] == "max" {
		return 0, 0, errors.New("invalid cpu limit")
	}
	q, e1 := strconv.ParseInt(f[0], 10, 64)
	p, e2 := strconv.ParseInt(f[1], 10, 64)
	if e1 != nil || e2 != nil || q <= 0 || p <= 0 {
		return 0, 0, errors.New("invalid cpu limit")
	}
	return q, p, nil
}
func cgroupPIDs(fs FileSystem, cgroup string) ([]int, error) {
	b, err := fs.ReadFile(cgroupFile(cgroup, "cgroup.procs"))
	if err != nil {
		return nil, errors.New("cgroup unavailable")
	}
	var result []int
	for _, field := range strings.Fields(string(b)) {
		v, err := strconv.Atoi(field)
		if err != nil || v <= 0 {
			return nil, errors.New("invalid cgroup members")
		}
		result = append(result, v)
	}
	return result, nil
}
func cgroupPopulated(fs FileSystem, cgroup string) (bool, error) {
	b, err := fs.ReadFile(cgroupFile(cgroup, "cgroup.events"))
	if err != nil {
		return false, errors.New("cgroup unavailable")
	}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) == 2 && f[0] == "populated" {
			return f[1] == "1", nil
		}
	}
	return false, errors.New("invalid cgroup events")
}

func cgroupIsPopulated(events []byte) bool {
	for _, line := range strings.Split(string(events), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "populated" {
			return fields[1] != "0"
		}
	}
	return true
}
func stringValue(p map[string]any, key string) string    { v, _ := p[key].(string); return v }
func boolValue(p map[string]any, key string) bool        { v, _ := p[key].(bool); return v }
func stringsValue(p map[string]any, key string) []string { v, _ := p[key].([]string); return v }
func uint64ValueOK(p map[string]any, key string) bool    { _, ok := p[key].(uint64); return ok }
func bindReadOnlyPathsValue(value any) ([]string, bool) {
	items := reflect.ValueOf(value)
	if !items.IsValid() || (items.Kind() != reflect.Slice && items.Kind() != reflect.Array) {
		return nil, false
	}
	result := make([]string, 0, items.Len())
	for i := 0; i < items.Len(); i++ {
		tuple := items.Index(i)
		if tuple.Kind() == reflect.Interface {
			tuple = tuple.Elem()
		}
		if !tuple.IsValid() || (tuple.Kind() != reflect.Struct && tuple.Kind() != reflect.Slice && tuple.Kind() != reflect.Array) {
			return nil, false
		}
		if (tuple.Kind() == reflect.Struct && tuple.NumField() != 4) || (tuple.Kind() != reflect.Struct && tuple.Len() != 4) {
			return nil, false
		}
		fields := [4]reflect.Value{}
		for j := range fields {
			if tuple.Kind() == reflect.Struct {
				fields[j] = tuple.Field(j)
			} else {
				fields[j] = tuple.Index(j)
			}
			if fields[j].Kind() == reflect.Interface {
				fields[j] = fields[j].Elem()
			}
		}
		if fields[0].Kind() != reflect.String || fields[1].Kind() != reflect.String || fields[2].Kind() != reflect.Bool || fields[3].Type() != reflect.TypeOf(uint64(0)) || fields[2].Bool() || fields[3].Uint() != 0 {
			return nil, false
		}
		source, destination := fields[0].String(), fields[1].String()
		if !validAbsolutePath(source) || !validAbsolutePath(destination) {
			return nil, false
		}
		result = append(result, source+":"+destination)
	}
	return result, true
}
func restrictAddressFamiliesValue(value any) (bool, []string, bool) {
	switch v := value.(type) {
	case restrictAddressFamilies:
		return v.Allow, v.Families, true
	case []any:
		if len(v) != 2 {
			return false, nil, false
		}
		allow, aok := v[0].(bool)
		families, fok := v[1].([]string)
		return allow, families, aok && fok
	}
	return false, nil, false
}
func intValue(p map[string]any, key string) int { return int(uintValue(p, key)) }
func uintValue(p map[string]any, key string) uint64 {
	switch v := p[key].(type) {
	case uint32:
		return uint64(v)
	case uint64:
		return v
	case int32:
		if v > 0 {
			return uint64(v)
		}
	case int:
		if v > 0 {
			return uint64(v)
		}
	}
	return 0
}

type godbusSystemBus struct{ conn *dbus.Conn }

func (b *godbusSystemBus) SupportsUnixFDs() bool {
	return b != nil && b.conn != nil && b.conn.SupportsUnixFDs()
}
func (b *godbusSystemBus) StartTransientUnit(ctx context.Context, name string, props []DBusProperty) error {
	return b.call(ctx, "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager.StartTransientUnit", name, "fail", dbusProperties(props), []auxiliaryUnit{})
}
func (b *godbusSystemBus) UnitProperties(ctx context.Context, name string) (map[string]any, error) {
	var path dbus.ObjectPath
	if err := b.conn.Object(systemdService, "/org/freedesktop/systemd1").CallWithContext(ctx, "org.freedesktop.systemd1.Manager.GetUnit", 0, name).Store(&path); err != nil {
		return nil, err
	}
	unit := b.conn.Object(systemdService, path)
	values, err := dbusInterfaceProperties(ctx, unit, "org.freedesktop.systemd1.Unit")
	if err != nil {
		return nil, err
	}
	service, err := dbusInterfaceProperties(ctx, unit, "org.freedesktop.systemd1.Service")
	if err != nil {
		return nil, err
	}
	for key, value := range service {
		values[key] = value
	}
	return values, nil
}
func (b *godbusSystemBus) StopUnit(ctx context.Context, name string) error {
	return b.call(ctx, "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager.StopUnit", name, "replace")
}
func (b *godbusSystemBus) KillUnit(ctx context.Context, name string) error {
	return b.call(ctx, "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager.KillUnit", name, "all", int32(9))
}
func (b *godbusSystemBus) ResetFailedUnit(ctx context.Context, name string) error {
	return b.call(ctx, "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager.ResetFailedUnit", name)
}
func (b *godbusSystemBus) call(ctx context.Context, path dbus.ObjectPath, method string, args ...any) error {
	if b == nil || b.conn == nil {
		return fmt.Errorf("system bus unavailable")
	}
	return b.conn.Object(systemdService, path).CallWithContext(ctx, method, 0, args...).Err
}

type dbusProperty struct {
	Name  string
	Value dbus.Variant
}

type auxiliaryUnit struct {
	Name       string
	Properties []dbusProperty
}

func dbusInterfaceProperties(ctx context.Context, unit dbus.BusObject, iface string) (map[string]any, error) {
	var values map[string]dbus.Variant
	if err := unit.CallWithContext(ctx, "org.freedesktop.DBus.Properties.GetAll", 0, iface).Store(&values); err != nil {
		return nil, err
	}
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value.Value()
	}
	return out, nil
}

func dbusProperties(props []DBusProperty) []dbusProperty {
	out := make([]dbusProperty, len(props))
	for i, p := range props {
		out[i] = dbusProperty{p.Name, dbus.MakeVariant(p.Value)}
	}
	return out
}
