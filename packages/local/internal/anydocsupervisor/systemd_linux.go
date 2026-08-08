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
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"golang.org/x/sys/unix"
)

const systemdService = "org.freedesktop.systemd1"

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
		return nil, errors.New("systemd unavailable")
	}
	name, err := transientUnitName()
	if err != nil {
		return nil, err
	}
	socketPath, listener, err := b.listen(spec, ".a-")
	if err != nil {
		return nil, errors.New("authorization channel unavailable")
	}
	if err := b.fs.Chmod(socketPath, 0); err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		return nil, errors.New("authorization channel unavailable")
	}
	resultPath, resultListener, err := b.listen(spec, ".r-")
	if err != nil || b.fs.Chmod(resultPath, 0) != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		if resultListener != nil {
			_ = resultListener.Close()
		}
		_ = os.Remove(resultPath)
		return nil, errors.New("result channel unavailable")
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
	spec.ReadOnlyPaths = append(spec.ReadOnlyPaths, socketPath, resultPath)
	properties := systemdProperties(spec)
	err = b.bus.StartTransientUnit(ctx, name, properties)
	closeErr := stdin.Close()
	if err != nil || closeErr != nil {
		return nil, errors.New("transient unit unavailable")
	}
	u := &systemdUnit{name: name, bus: b.bus, fs: b.fs, procFS: b.procFS, now: b.now, tmp: onlyPrivateTemp(spec), listener: listener, socket: socketPath, resultListener: resultListener, resultSocket: resultPath, peers: b.peers, spec: spec}
	if err := u.waitActive(ctx); err != nil {
		_ = u.Stop(context.Background())
		_ = u.Cleanup(context.Background())
		return nil, err
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
	if len(spec.Command) != 2 || !validAbsolutePath(spec.Command[0]) || !validAbsolutePath(spec.Command[1]) || spec.NodeSHA256 == "" || len(spec.runtimeTreeDigest) != sha256.Size*2 || !same(spec.Environment, []string{"LANG=C", "PATH=/usr/bin:/bin"}) || len(spec.ReadOnlyPaths) != 0 || len(spec.BindReadOnlyPaths) != 2 || len(spec.ReadWritePaths) != 1 || !same(spec.RestrictAddressFamilies, []string{"AF_UNIX"}) {
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

func systemdProperties(spec ServiceSpec) []DBusProperty {
	sockets := []string{}
	if len(spec.ReadOnlyPaths) >= 2 {
		sockets = spec.ReadOnlyPaths[len(spec.ReadOnlyPaths)-2:]
	}
	return []DBusProperty{
		{"Description", "Crux Anydoc isolated runner"},
		{"Type", "exec"},
		{"ExecStart", []execStart{{Path: spec.Command[0], Args: append(append([]string{}, spec.Command...), sockets...), Fail: false}}},
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
		{"ProtectHome", spec.ProtectHome},
		{"ReadOnlyPaths", spec.ReadOnlyPaths},
		{"BindReadOnlyPaths", spec.BindReadOnlyPaths},
		{"ReadWritePaths", spec.ReadWritePaths},
	}
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
	name           string
	bus            SystemBus
	fs             FileSystem
	procFS         ProcRuntimeFS
	now            Clock
	tmp            string
	listener       *net.UnixListener
	socket         string
	resultListener *net.UnixListener
	resultSocket   string
	peers          PeerVerifier
	spec           ServiceSpec
}

func (u *systemdUnit) VerifiedServiceSpec(_ ServiceSpec) ServiceSpec { return u.spec }

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
	memory, err := cgroupLimit(u.fs, cgroup, "memory.max")
	if err != nil {
		return SandboxReport{}, err
	}
	memoryCurrent, err := cgroupLimit(u.fs, cgroup, "memory.current")
	if err != nil {
		return SandboxReport{}, err
	}
	memoryEvents, err := cgroupEvents(u.fs, cgroup, "memory.events")
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
	if !ok || !uint64ValueOK(p, "CapabilityBoundingSet") || !uint64ValueOK(p, "AmbientCapabilities") {
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
	return SandboxReport{MainPID: pid, RuntimeTreeDigest: runtimeDigest, UID: uintValue(p, "UID"), DynamicUser: boolValue(p, "DynamicUser"), PrivateUsers: boolValue(p, "PrivateUsers"), ProtectProc: stringValue(p, "ProtectProc"), ProcSubset: stringValue(p, "ProcSubset"), ControlGroupMembers: members, MemoryMax: memory, MemoryCurrent: memoryCurrent, MemoryEvents: memoryEvents, MemorySwapMax: swap, TasksMax: int(tasks), CPUQuotaPercent: int(quota * 100 / period), CPUQuotaPeriodUSec: int(period), RuntimeMax: time.Duration(uintValue(p, "RuntimeMaxUSec")) * time.Microsecond, KillMode: stringValue(p, "KillMode"), ProtectSystem: stringValue(p, "ProtectSystem"), CPUAccounting: boolValue(p, "CPUAccounting"), NoNewPrivileges: boolValue(p, "NoNewPrivileges"), PrivateNetwork: boolValue(p, "PrivateNetwork"), PrivateTmp: boolValue(p, "PrivateTmp"), ProtectHome: boolValue(p, "ProtectHome"), CapabilityBoundingSet: uintValue(p, "CapabilityBoundingSet"), AmbientCapabilities: uintValue(p, "AmbientCapabilities"), ReadOnlyPaths: stringsValue(p, "ReadOnlyPaths"), BindReadOnlyPaths: stringsValue(p, "BindReadOnlyPaths"), ReadWritePaths: stringsValue(p, "ReadWritePaths"), RestrictAddressFamiliesAllow: rafAllow, RestrictAddressFamilies: raf, Populated: populated}, nil
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
	for {
		conn, err := u.listener.AcceptUnix()
		if err != nil {
			return errors.New("authorization unavailable")
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
				return errors.New("authorization unavailable")
			}
			return nil
		}
		_ = conn.Close()
		select {
		case <-ctx.Done():
			return errors.New("authorization unavailable")
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
	if err := u.fs.Chown(u.socket, int(report.UID), 0); err != nil {
		return errors.New("authorization unavailable")
	}
	if err := u.fs.Chmod(u.socket, 0600); err != nil || u.fs.Chown(u.resultSocket, int(report.UID), 0) != nil || u.fs.Chmod(u.resultSocket, 0600) != nil {
		return errors.New("authorization unavailable")
	}
	return nil
}

func (u *systemdUnit) ReceiveResult(ctx context.Context, expected Request) (Result, error) {
	if u.resultListener == nil || u.peers == nil {
		return Result{}, errors.New("result unavailable")
	}
	defer func() {
		_ = u.resultListener.Close()
		u.resultListener = nil
		_ = os.Remove(u.resultSocket)
	}()
	if deadline, ok := ctx.Deadline(); ok {
		_ = u.resultListener.SetDeadline(deadline)
	}
	for {
		conn, err := u.resultListener.AcceptUnix()
		if err != nil {
			return Result{}, errors.New("result unavailable")
		}
		pid, uid, peerErr := u.peers.Credentials(conn)
		report, reportErr := u.Report(ctx)
		if peerErr == nil && reportErr == nil && pid == report.MainPID && uint64(uid) == report.UID && contains(report.ControlGroupMembers, pid) {
			if deadline, ok := ctx.Deadline(); ok {
				_ = conn.SetDeadline(deadline)
			}
			result, decodeErr := DecodeResult(conn)
			if decodeErr == nil && result.Request != expected {
				decodeErr = errors.New("result capability mismatch")
			}
			if decodeErr == nil {
				_, decodeErr = conn.Write([]byte("ACK\n"))
			}
			_ = conn.Close()
			if decodeErr != nil {
				return Result{}, errors.New("invalid result")
			}
			return result, nil
		}
		_ = conn.Close()
		select {
		case <-ctx.Done():
			return Result{}, errors.New("result unavailable")
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
				return time.Duration(v) * time.Microsecond, nil
			}
		}
	}
	return 0, errors.New("cpu accounting unavailable")
}

func (u *systemdUnit) Stop(ctx context.Context) error {
	if err := u.bus.StopUnit(ctx, u.name); err == nil {
		return nil
	}
	if err := u.bus.KillUnit(ctx, u.name); err == nil {
		return nil
	}
	p, err := u.bus.UnitProperties(ctx, u.name)
	if err != nil || !validCgroup(stringValue(p, "ControlGroup")) {
		return errors.New("unit stop unavailable")
	}
	if err := u.fs.WriteFile(cgroupFile(stringValue(p, "ControlGroup"), "cgroup.kill"), []byte("1")); err != nil {
		return errors.New("unit stop unavailable")
	}
	return nil
}

func (u *systemdUnit) WaitInactive(ctx context.Context) error {
	for {
		p, err := u.bus.UnitProperties(ctx, u.name)
		if err != nil {
			return errors.New("unit status unavailable")
		}
		if stringValue(p, "ActiveState") == "inactive" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-u.now.After(10 * time.Millisecond):
		}
	}
}

func (u *systemdUnit) Cleanup(ctx context.Context) error {
	if u.listener != nil {
		_ = u.listener.Close()
		u.listener = nil
	}
	if u.socket != "" {
		_ = os.Remove(u.socket)
	}
	if u.resultListener != nil {
		_ = u.resultListener.Close()
		u.resultListener = nil
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
func stringValue(p map[string]any, key string) string    { v, _ := p[key].(string); return v }
func boolValue(p map[string]any, key string) bool        { v, _ := p[key].(bool); return v }
func stringsValue(p map[string]any, key string) []string { v, _ := p[key].([]string); return v }
func uint64ValueOK(p map[string]any, key string) bool    { _, ok := p[key].(uint64); return ok }
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
