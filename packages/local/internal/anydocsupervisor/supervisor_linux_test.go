//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPipeAuthorizationIsOneShotAndEOF(t *testing.T) {
	b := &fakeBackend{}
	r, e := newTestSupervisor(t, b).Start(context.Background(), []byte("x"), testLaunch(), "/run/tmp", Limits{})
	if e != nil {
		t.Fatal(e)
	}
	d := sha256.Sum256([]byte("x"))
	v := Request{Version: 1, Nonce: r.nonce, RequestDigest: requestDigest(1, r.nonce, "docx", hex.EncodeToString(d[:]), 1, JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}), SourceSHA256: hex.EncodeToString(d[:]), Format: "docx", SourceBytes: 1, Limits: JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}}
	if e = r.Authorize(); e != nil {
		t.Fatal(e)
	}
	got, e := DecodeRequest(b.read)
	if e != nil || got != v {
		t.Fatal(e)
	}
	_, e = b.read.Read(make([]byte, 1))
	if !errors.Is(e, io.EOF) {
		t.Fatal("want EOF")
	}
	assert(t, r.Authorize(), ErrReplay)
}

func TestPrepareLocalHostBuildsOpaqueLaunchDependencyWithoutRouting(t *testing.T) {
	t.Setenv("CRUX_CACHE_DIR", t.TempDir())
	launch, err := PrepareLocalHost()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = filepath.Walk(launch.runtimeRoot, func(path string, info os.FileInfo, err error) error {
			if err == nil && info.IsDir() {
				_ = os.Chmod(path, 0o755)
			}
			return nil
		})
	})
	if launch.runtimeRoot == "" || launch.runtimeRunner != filepath.Join(launch.runtimeRoot, "runner.mjs") || len(launch.runtimeTreeDigest) != 64 || launch.nodePath == "" || len(launch.nodeSHA256) != 64 {
		t.Fatalf("invalid prepared launch dependency: %#v", launch)
	}
}
func TestWrongAndConcurrentAuthorize(t *testing.T) {
	b := &fakeBackend{}
	r, _ := newTestSupervisor(t, b).Start(context.Background(), []byte("x"), testLaunch(), "/run/tmp", Limits{})
	ch := make(chan error, 2)
	go func() { ch <- r.Authorize() }()
	go func() { ch <- r.Authorize() }()
	a, z := <-ch, <-ch
	if (a == nil) == (z == nil) {
		t.Fatal("exactly one authorization")
	}
	r.Finish(context.Background(), nil)
}
func TestSpecAndMismatchCleanup(t *testing.T) {
	_, e := newTestServiceSpec("/run/x", "/run/x/a", "/run/t", Limits{})
	assert(t, e, ErrInvalidRequest)
	b := &fakeBackend{bad: true}
	supervisor := newTestSupervisor(t, b)
	_, e = supervisor.Start(context.Background(), []byte("x"), testLaunch(), "/run/tmp", Limits{})
	assert(t, e, ErrContainmentUnavailable)
	if !b.u.Stopped() || !b.u.Cleaned() {
		t.Fatal("cleanup")
	}
	entries, readErr := os.ReadDir(supervisor.stager.root)
	if readErr != nil || len(entries) != 0 {
		t.Fatalf("start failure retained staged source: %#v, %v", entries, readErr)
	}
}
func TestCPULimitStops(t *testing.T) {
	b := &fakeBackend{cpu: CPUCeiling + time.Second}
	r, e := newTestSupervisor(t, b).Start(context.Background(), []byte("x"), testLaunch(), "/run/tmp", Limits{})
	if e != nil {
		t.Fatal(e)
	}
	time.Sleep(30 * time.Millisecond)
	if !b.u.Stopped() {
		t.Fatal("cpu was not stopped")
	}
	r.Finish(context.Background(), nil)
}
func TestResultFramesRejectOversizedAndInvalidAccounting(t *testing.T) {
	oversized := make([]byte, 4)
	binary.BigEndian.PutUint32(oversized, MaxFrameBytes+1)
	_, err := DecodeResult(bytes.NewReader(oversized))
	assert(t, err, ErrInvalidFrame)
	err = EncodeResult(bytes.NewBuffer(nil), Result{Request: Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), RequestDigest: strings.Repeat("b", 64), SourceSHA256: strings.Repeat("c", 64), Format: "docx", Limits: JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}}, OK: true, Error: ErrTimeout})
	assert(t, err, ErrInvalidRequest)
}
func TestExecuteFinishesAfterResultFailure(t *testing.T) {
	b := &fakeBackend{}
	supervisor := newTestSupervisor(t, b)
	r, err := supervisor.Start(context.Background(), []byte("x"), testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.Execute(context.Background())
	assert(t, err, ErrWorkerCrash)
	if !b.u.Cleaned() {
		t.Fatal("result failure did not clean up")
	}
	entries, readErr := os.ReadDir(supervisor.stager.root)
	if readErr != nil || len(entries) != 0 {
		t.Fatalf("terminal failure retained staged source: %#v, %v", entries, readErr)
	}
}
func TestCPUQuotaBoundsRuntimeBudgetAndUsageFailureFailsClosed(t *testing.T) {
	if time.Duration(CPUQuotaPercent)*RuntimeCeiling/100 >= CPUCeiling {
		t.Fatal("service quota can exceed CPU budget")
	}
	b := &fakeBackend{cpuErr: true}
	r, e := newTestSupervisor(t, b).Start(context.Background(), []byte("x"), testLaunch(), "/run/tmp", Limits{})
	if e != nil {
		t.Fatal(e)
	}
	time.Sleep(30 * time.Millisecond)
	assert(t, r.Finish(context.Background(), nil), ErrContainmentUnavailable)
}

func newTestSupervisor(t *testing.T, backend Backend) *Supervisor {
	t.Helper()
	return NewWithStager(backend, NewStager(t.TempDir()))
}

func testLaunch() LaunchDependency {
	return LaunchDependency{
		runtimeRoot:       "/run/run",
		runtimeRunner:     "/run/run/runner.mjs",
		runtimeTreeDigest: strings.Repeat("d", 64),
		nodePath:          "/usr/bin/node",
		nodeSHA256:        strings.Repeat("e", 64),
	}
}

func newTestServiceSpec(hostSource, runtime, tmp string, limits Limits) (ServiceSpec, error) {
	launch := testLaunch()
	launch.runtimeRoot = runtime
	launch.runtimeRunner = filepath.Join(runtime, "runner.mjs")
	return serviceSpec(hostSource, launch, tmp, limits)
}

func TestRequestDigestBindsEveryJobField(t *testing.T) {
	limits := JobLimits{SourceBytes: 1024, ResultBytes: 2048}
	base := requestDigest(1, strings.Repeat("a", 32), "docx", strings.Repeat("b", 64), 3, limits)
	if base != "4e4347a464cdcead83d42ecbfbbe90a15bc0c95cfeb01b5b9158b2c5af2220c2" {
		t.Fatalf("fixed digest = %s", base)
	}
	for _, changed := range []string{
		requestDigest(1, strings.Repeat("c", 32), "docx", strings.Repeat("b", 64), 3, limits),
		requestDigest(1, strings.Repeat("a", 32), "odt", strings.Repeat("b", 64), 3, limits),
		requestDigest(1, strings.Repeat("a", 32), "docx", strings.Repeat("c", 64), 3, limits),
		requestDigest(1, strings.Repeat("a", 32), "docx", strings.Repeat("b", 64), 4, limits),
		requestDigest(1, strings.Repeat("a", 32), "docx", strings.Repeat("b", 64), 3, JobLimits{SourceBytes: 1025, ResultBytes: 2048}),
		requestDigest(1, strings.Repeat("a", 32), "docx", strings.Repeat("b", 64), 3, JobLimits{SourceBytes: 1024, ResultBytes: 2049}),
	} {
		if changed == base {
			t.Fatal("digest omitted a job field")
		}
	}
}

func TestStagerCreatesVerifiedPrivateSourceAndCleansIt(t *testing.T) {
	stager := NewStager(t.TempDir())
	staged, err := stager.Stage([]byte("source"), 16)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(staged.HostPath)
	if err != nil || info.Mode().Perm() != 0400 || !info.Mode().IsRegular() {
		t.Fatalf("staged source = %#v, %v", info, err)
	}
	if err := staged.Cleanup(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(staged.HostPath); !os.IsNotExist(err) {
		t.Fatalf("staged source retained: %v", err)
	}
}

func TestStagerRejectsTamperingAndUnsafeRoots(t *testing.T) {
	root := t.TempDir()
	stager := NewStager(root)
	staged, err := stager.Stage([]byte("source"), 16)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(staged.HostPath, 0600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte("source"))
	if err := verifyStagedSource(staged.HostPath, 6, hash[:], 16); err == nil {
		t.Fatal("tampered staged source accepted")
	}
	if err := staged.Cleanup(); err != nil {
		t.Fatal(err)
	}
	file := t.TempDir() + "/not-a-directory"
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStager(file).Stage([]byte("x"), 1); err == nil {
		t.Fatal("non-directory stage root accepted")
	}
	link := t.TempDir() + "/stage-link"
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStager(link).Stage([]byte("x"), 1); err == nil {
		t.Fatal("symlink stage root accepted")
	}
}
func assert(t *testing.T, e error, c ErrorCode) {
	t.Helper()
	var x *SupervisorError
	if !errors.As(e, &x) || x.Code != c {
		t.Fatalf("%v", e)
	}
}

type fakeBackend struct {
	u      *fakeUnit
	read   *os.File
	bad    bool
	cpu    time.Duration
	cpuErr bool
}

func (b *fakeBackend) Start(_ context.Context, s ServiceSpec, r *os.File) (Unit, error) {
	b.read = r
	rep := SandboxReport{MainPID: 42, RuntimeTreeDigest: s.runtimeTreeDigest, UID: 1000, DynamicUser: true, PrivateUsers: true, ProtectProc: "invisible", ProcSubset: "pid", ControlGroupMembers: []int{42}, MemoryMax: s.MemoryMax, MemorySwapMax: 0, TasksMax: s.TasksMax, CPUQuotaPercent: s.CPUQuotaPercent, CPUQuotaPeriodUSec: s.CPUQuotaPeriodUSec, RuntimeMax: s.RuntimeMax, KillMode: s.KillMode, ProtectSystem: s.ProtectSystem, CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true, CapabilityBoundingSet: 0, AmbientCapabilities: 0, ReadOnlyPaths: s.ReadOnlyPaths, BindReadOnlyPaths: s.BindReadOnlyPaths, ReadWritePaths: s.ReadWritePaths, RestrictAddressFamiliesAllow: true, RestrictAddressFamilies: s.RestrictAddressFamilies, Populated: true}
	if b.bad {
		rep.MemoryMax = 1
	}
	b.u = &fakeUnit{rep: rep, cpu: b.cpu, cpuErr: b.cpuErr}
	return b.u, nil
}

type fakeUnit struct {
	rep              SandboxReport
	cpu              time.Duration
	cpuErr           bool
	stopped, cleaned bool
	mu               sync.Mutex
}

func (u *fakeUnit) Report(context.Context) (SandboxReport, error) { return u.rep, nil }
func (u *fakeUnit) CPUUsage(context.Context) (time.Duration, error) {
	if u.cpuErr {
		return 0, errors.New("unavailable")
	}
	return u.cpu, nil
}
func (u *fakeUnit) Stop(context.Context) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.stopped = true
	u.rep.Populated = false
	return nil
}
func (u *fakeUnit) WaitInactive(context.Context) error { return nil }
func (u *fakeUnit) Cleanup(context.Context) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.cleaned = true
	return nil
}
func (u *fakeUnit) Stopped() bool { u.mu.Lock(); defer u.mu.Unlock(); return u.stopped }
func (u *fakeUnit) Cleaned() bool { u.mu.Lock(); defer u.mu.Unlock(); return u.cleaned }
