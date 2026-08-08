//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

func TestRequestCodecRejectsFragmentedOversizedExtraAndInvalidFrames(t *testing.T) {
	request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), Digest: strings.Repeat("b", 64)}
	var encoded bytes.Buffer
	if err := EncodeRequest(&encoded, request); err != nil {
		t.Fatal(err)
	}
	got, err := DecodeRequest(bytes.NewReader(encoded.Bytes()))
	if err != nil || got != request {
		t.Fatalf("DecodeRequest() = %#v, %v", got, err)
	}

	for _, frame := range [][]byte{encoded.Bytes()[:5], append(encoded.Bytes(), 0), {0, 128, 0, 1}} {
		_, err := DecodeRequest(bytes.NewReader(frame))
		assertCode(t, err, ErrInvalidFrame)
	}
	_, err = DecodeRequest(bytes.NewReader([]byte{0, 0, 0, 2, '{', '}'}))
	assertCode(t, err, ErrInvalidRequest)
}

func TestResultCodecIsVersionedBoundedAndClosed(t *testing.T) {
	want := Result{Version: ProtocolVersion, OK: false, Error: ErrTimeout, Payload: []byte("diagnostic")}
	var encoded bytes.Buffer
	if err := EncodeResult(&encoded, want); err != nil {
		t.Fatal(err)
	}
	got, err := DecodeResult(bytes.NewReader(encoded.Bytes()))
	if err != nil || !bytes.Equal(got.Payload, want.Payload) || got.Error != want.Error {
		t.Fatalf("DecodeResult() = %#v, %v", got, err)
	}
	assertCode(t, EncodeResult(&bytes.Buffer{}, Result{Version: ProtocolVersion, Error: "open-ended"}), ErrInvalidRequest)
}

func TestServiceSpecIsExactAndClampsRequestedLimits(t *testing.T) {
	spec, err := NewServiceSpec("/run/crux/input", "/run/crux/runtime", "/run/crux/tmp", Limits{MemoryMax: MemoryCeiling + 1, TasksMax: TasksCeiling + 1, CPUQuotaPercent: CPUQuotaPercent + 1, RuntimeMax: RuntimeCeiling + 1})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := spec.Command, []string{"/usr/lib/crux/anydoc-runner"}; !samePaths(got, want) {
		t.Fatalf("Command = %v, want %v", got, want)
	}
	if spec.MemoryMax != MemoryCeiling || spec.MemorySwapMax != 0 || spec.TasksMax != TasksCeiling || spec.CPUQuotaPercent != CPUQuotaPercent || spec.CPUQuotaPeriodUSec != CPUPeriodUSec || spec.RuntimeMax != RuntimeCeiling || spec.KillMode != "control-group" {
		t.Fatalf("limits = %#v", spec)
	}
	if !spec.NoNewPrivileges || !spec.PrivateNetwork || !spec.PrivateTmp || spec.ProtectSystem != "strict" || !spec.ProtectHome || len(spec.CapabilityBoundingSet) != 0 {
		t.Fatalf("sandbox = %#v", spec)
	}
	if !samePaths(spec.ReadOnlyPaths, []string{"/run/crux/input", "/run/crux/runtime"}) || !samePaths(spec.ReadWritePaths, []string{"/run/crux/tmp"}) {
		t.Fatalf("mount policy = %#v", spec)
	}
	_, err = NewServiceSpec("relative", "/run/runtime", "/run/tmp", Limits{})
	assertCode(t, err, ErrInvalidRequest)
}

func TestStartVerifiesBeforeReleasingSingleUseCapability(t *testing.T) {
	backend := &fakeBackend{}
	run, err := New(backend).Start(context.Background(), []byte("document"), "/run/input", "/run/runtime", "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if !backend.unit.released || backend.unit.imported {
		t.Fatalf("release/import state = %#v", backend.unit)
	}
	capability := run.Capability()
	if capability.Version != 1 || capability.VerifiedBy != "host-supervisor" || capability.FilesystemRead != "input-only" || capability.FilesystemWrite != "private-temp-only" || capability.OutboundNetwork != "denied" || capability.PrivilegeEscalation != "denied" {
		t.Fatalf("capability = %#v", capability)
	}
	request := Request{Version: ProtocolVersion, Nonce: backend.unit.nonce, Digest: backend.unit.digest}
	if err := run.Authorize(request); err != nil {
		t.Fatal(err)
	}
	backend.unit.imported = true
	assertCode(t, run.Authorize(request), ErrReplay)
}

func TestStartRejectsWrongRequestAndVerificationMismatchWithoutImport(t *testing.T) {
	backend := &fakeBackend{mutate: func(report *SandboxReport) { report.MemorySwapMax = 1 }}
	_, err := New(backend).Start(context.Background(), []byte("document"), "/run/input", "/run/runtime", "/run/tmp", Limits{})
	assertCode(t, err, ErrContainmentUnavailable)
	if backend.unit.released || backend.unit.imported || !backend.unit.stopped || !backend.unit.waited || !backend.unit.cleaned {
		t.Fatalf("mismatch lifecycle = %#v", backend.unit)
	}

	backend = &fakeBackend{}
	run, err := New(backend).Start(context.Background(), []byte("document"), "/run/input", "/run/runtime", "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	wrong := Request{Version: ProtocolVersion, Nonce: strings.Repeat("c", 32), Digest: backend.unit.digest}
	assertCode(t, run.Authorize(wrong), ErrReplay)
	if backend.unit.imported {
		t.Fatal("runner imported before request authorization")
	}
}

func TestFinishAlwaysStopsWaitsForEmptyUnitAndCleans(t *testing.T) {
	for name, outcome := range map[string]error{"leader crash": errors.New("signal: killed"), "timeout": context.DeadlineExceeded, "abort": context.Canceled, "success": nil} {
		t.Run(name, func(t *testing.T) {
			backend := &fakeBackend{}
			run, err := New(backend).Start(context.Background(), []byte("document"), "/run/input", "/run/runtime", "/run/tmp", Limits{})
			if err != nil {
				t.Fatal(err)
			}
			err = run.Finish(context.Background(), outcome)
			if outcome != nil && err == nil {
				t.Fatal("Finish() error = nil")
			}
			if outcome == nil && err != nil {
				t.Fatal(err)
			}
			if !backend.unit.stopped || !backend.unit.waited || !backend.unit.cleaned || backend.unit.report.Populated {
				t.Fatalf("lifecycle = %#v", backend.unit)
			}
		})
	}
}

func assertCode(t *testing.T, err error, want ErrorCode) {
	t.Helper()
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != want {
		t.Fatalf("error = %T %v, want %s", err, err, want)
	}
}

type fakeBackend struct {
	unit   *fakeUnit
	mutate func(*SandboxReport)
}

func (f *fakeBackend) Start(_ context.Context, spec ServiceSpec) (Unit, error) {
	report := SandboxReport{MainPID: 42, ControlGroupMembers: []int{42}, MemoryMax: spec.MemoryMax, MemorySwapMax: spec.MemorySwapMax, TasksMax: spec.TasksMax, CPUQuotaPercent: spec.CPUQuotaPercent, CPUQuotaPeriodUSec: spec.CPUQuotaPeriodUSec, RuntimeMax: spec.RuntimeMax, KillMode: spec.KillMode, NoNewPrivileges: spec.NoNewPrivileges, PrivateNetwork: spec.PrivateNetwork, PrivateTmp: spec.PrivateTmp, ProtectSystem: spec.ProtectSystem, ProtectHome: spec.ProtectHome, CapabilityBoundingSet: append([]string(nil), spec.CapabilityBoundingSet...), ReadOnlyPaths: append([]string(nil), spec.ReadOnlyPaths...), ReadWritePaths: append([]string(nil), spec.ReadWritePaths...), Populated: true}
	if f.mutate != nil {
		f.mutate(&report)
	}
	f.unit = &fakeUnit{report: report}
	return f.unit, nil
}

type fakeUnit struct {
	report                                       SandboxReport
	nonce, digest                                string
	released, imported, stopped, waited, cleaned bool
}

func (u *fakeUnit) Report(context.Context) (SandboxReport, error) { return u.report, nil }
func (u *fakeUnit) ReleaseCapabilityFD(_ context.Context, nonce, digest string) (int, error) {
	u.released, u.nonce, u.digest = true, nonce, digest
	return 3, nil
}
func (u *fakeUnit) Stop(context.Context) error {
	u.stopped = true
	u.report.Populated = false
	return nil
}
func (u *fakeUnit) WaitInactive(context.Context) error {
	u.waited = true
	if u.report.Populated {
		return errors.New("unit still populated")
	}
	return nil
}
func (u *fakeUnit) Cleanup(context.Context) error { u.cleaned = true; return nil }
