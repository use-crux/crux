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
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPipeAuthorizationIsOneShotAndEOF(t *testing.T) {
	b := &fakeBackend{}
	r, e := New(b).Start(context.Background(), []byte("x"), "/run/in", "/run/run", "/run/tmp", Limits{})
	if e != nil {
		t.Fatal(e)
	}
	d := sha256.Sum256([]byte("x"))
	v := Request{Version: 1, Nonce: r.nonce, RequestDigest: hex.EncodeToString(d[:]), SourceSHA256: hex.EncodeToString(d[:]), Format: "docx", SourceBytes: 1, Limits: Limits{}.Clamp()}
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
func TestWrongAndConcurrentAuthorize(t *testing.T) {
	b := &fakeBackend{}
	r, _ := New(b).Start(context.Background(), []byte("x"), "/run/in", "/run/run", "/run/tmp", Limits{})
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
	_, e := NewServiceSpec("/run/x", "/run/x/a", "/run/t", Limits{})
	assert(t, e, ErrInvalidRequest)
	b := &fakeBackend{bad: true}
	_, e = New(b).Start(context.Background(), []byte("x"), "/run/in", "/run/run", "/run/tmp", Limits{})
	assert(t, e, ErrContainmentUnavailable)
	if !b.u.Stopped() || !b.u.Cleaned() {
		t.Fatal("cleanup")
	}
}
func TestCPULimitStops(t *testing.T) {
	b := &fakeBackend{cpu: CPUCeiling + time.Second}
	r, e := New(b).Start(context.Background(), []byte("x"), "/run/in", "/run/run", "/run/tmp", Limits{})
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
	err = EncodeResult(bytes.NewBuffer(nil), Result{Request: Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), RequestDigest: strings.Repeat("b", 64), SourceSHA256: strings.Repeat("c", 64), Format: "docx"}, OK: true, Error: ErrTimeout})
	assert(t, err, ErrInvalidRequest)
}
func TestExecuteFinishesAfterResultFailure(t *testing.T) {
	b := &fakeBackend{}
	r, err := New(b).Start(context.Background(), []byte("x"), "/run/in", "/run/run", "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.Execute(context.Background())
	assert(t, err, ErrWorkerCrash)
	if !b.u.Cleaned() {
		t.Fatal("result failure did not clean up")
	}
}
func TestCPUQuotaBoundsRuntimeBudgetAndUsageFailureFailsClosed(t *testing.T) {
	if time.Duration(CPUQuotaPercent)*RuntimeCeiling/100 >= CPUCeiling {
		t.Fatal("service quota can exceed CPU budget")
	}
	b := &fakeBackend{cpuErr: true}
	r, e := New(b).Start(context.Background(), []byte("x"), "/run/in", "/run/run", "/run/tmp", Limits{})
	if e != nil {
		t.Fatal(e)
	}
	time.Sleep(30 * time.Millisecond)
	assert(t, r.Finish(context.Background(), nil), ErrContainmentUnavailable)
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
	rep := SandboxReport{MainPID: 42, UID: 1000, DynamicUser: true, PrivateUsers: true, ProtectProc: "invisible", ProcSubset: "pid", ControlGroupMembers: []int{42}, MemoryMax: s.MemoryMax, MemorySwapMax: 0, TasksMax: s.TasksMax, CPUQuotaPercent: s.CPUQuotaPercent, CPUQuotaPeriodUSec: s.CPUQuotaPeriodUSec, RuntimeMax: s.RuntimeMax, KillMode: s.KillMode, ProtectSystem: s.ProtectSystem, CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true, CapabilityBoundingSet: 0, AmbientCapabilities: 0, ReadOnlyPaths: s.ReadOnlyPaths, ReadWritePaths: s.ReadWritePaths, RestrictAddressFamiliesAllow: true, RestrictAddressFamilies: s.RestrictAddressFamilies, Populated: true}
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
