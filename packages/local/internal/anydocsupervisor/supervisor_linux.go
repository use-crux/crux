//go:build linux

// Package anydocsupervisor owns the fail-closed Linux containment boundary for
// a future Anydoc runner. It intentionally has no parser or D-Bus dependency.
package anydocsupervisor

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"
)

const (
	ProtocolVersion = 1
	MaxFrameBytes   = 8 << 20
	MemoryCeiling   = 512 << 20
	TasksCeiling    = 64
	CPUQuotaPercent = 100
	CPUPeriodUSec   = 1_000_000
	RuntimeCeiling  = 30 * time.Second
)

type ErrorCode string

const (
	ErrContainmentUnavailable ErrorCode = "containment-unavailable"
	ErrInvalidFrame           ErrorCode = "invalid-frame"
	ErrInvalidRequest         ErrorCode = "invalid-request"
	ErrReplay                 ErrorCode = "replay"
	ErrWorkerCrash            ErrorCode = "worker-crash"
	ErrTimeout                ErrorCode = "timeout"
	ErrAborted                ErrorCode = "aborted"
)

type Error struct {
	Code    ErrorCode
	Message string
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }
func fail(code ErrorCode, format string, args ...any) error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

type Request struct {
	Version int    `json:"version"`
	Nonce   string `json:"nonce"`
	Digest  string `json:"digest"`
}

// Result is the bounded, versioned worker response envelope. It deliberately
// admits only the supervisor's closed failure vocabulary.
type Result struct {
	Version int       `json:"version"`
	OK      bool      `json:"ok"`
	Error   ErrorCode `json:"error,omitempty"`
	Payload []byte    `json:"payload,omitempty"`
}

// EncodeRequest writes one bounded, length-prefixed request frame.
func EncodeRequest(w io.Writer, request Request) error {
	if err := validateRequest(request); err != nil {
		return err
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return fail(ErrInvalidRequest, "encode request")
	}
	if len(payload) > MaxFrameBytes {
		return fail(ErrInvalidFrame, "frame exceeds %d bytes", MaxFrameBytes)
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := w.Write(header[:]); err != nil {
		return err
	}
	_, err = w.Write(payload)
	return err
}

// DecodeRequest consumes exactly one frame. Trailing bytes are forbidden so a
// caller cannot accidentally treat multiple requests as one authorization.
func DecodeRequest(r io.Reader) (Request, error) {
	var header [4]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Request{}, fail(ErrInvalidFrame, "read header: %v", err)
	}
	size := binary.BigEndian.Uint32(header[:])
	if size == 0 || size > MaxFrameBytes {
		return Request{}, fail(ErrInvalidFrame, "invalid frame length %d", size)
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(r, payload); err != nil {
		return Request{}, fail(ErrInvalidFrame, "truncated frame: %v", err)
	}
	var request Request
	if err := json.Unmarshal(payload, &request); err != nil {
		return Request{}, fail(ErrInvalidFrame, "invalid json")
	}
	var extra [1]byte
	if n, err := r.Read(extra[:]); n != 0 || (err != nil && !errors.Is(err, io.EOF)) {
		return Request{}, fail(ErrInvalidFrame, "extra data after frame")
	}
	if err := validateRequest(request); err != nil {
		return Request{}, err
	}
	return request, nil
}

func validateRequest(request Request) error {
	if request.Version != ProtocolVersion {
		return fail(ErrInvalidRequest, "unsupported version %d", request.Version)
	}
	if len(request.Nonce) != 32 || !isHex(request.Nonce) {
		return fail(ErrInvalidRequest, "nonce must be 16-byte hex")
	}
	if len(request.Digest) != 64 || !isHex(request.Digest) {
		return fail(ErrInvalidRequest, "digest must be sha-256 hex")
	}
	return nil
}

func EncodeResult(w io.Writer, result Result) error {
	if err := validateResult(result); err != nil {
		return err
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return fail(ErrInvalidFrame, "encode result")
	}
	if len(payload) == 0 || len(payload) > MaxFrameBytes {
		return fail(ErrInvalidFrame, "invalid result frame length")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := w.Write(header[:]); err != nil {
		return err
	}
	_, err = w.Write(payload)
	return err
}

func DecodeResult(r io.Reader) (Result, error) {
	var header [4]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Result{}, fail(ErrInvalidFrame, "read result header: %v", err)
	}
	size := binary.BigEndian.Uint32(header[:])
	if size == 0 || size > MaxFrameBytes {
		return Result{}, fail(ErrInvalidFrame, "invalid result frame length %d", size)
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(r, payload); err != nil {
		return Result{}, fail(ErrInvalidFrame, "truncated result frame: %v", err)
	}
	var extra [1]byte
	if n, err := r.Read(extra[:]); n != 0 || (err != nil && !errors.Is(err, io.EOF)) {
		return Result{}, fail(ErrInvalidFrame, "extra data after result frame")
	}
	var result Result
	if err := json.Unmarshal(payload, &result); err != nil {
		return Result{}, fail(ErrInvalidFrame, "invalid result json")
	}
	if err := validateResult(result); err != nil {
		return Result{}, err
	}
	return result, nil
}

func validateResult(result Result) error {
	if result.Version != ProtocolVersion {
		return fail(ErrInvalidRequest, "unsupported version %d", result.Version)
	}
	if len(result.Payload) > MaxFrameBytes {
		return fail(ErrInvalidFrame, "result exceeds %d bytes", MaxFrameBytes)
	}
	if result.OK && result.Error != "" {
		return fail(ErrInvalidRequest, "successful result has an error")
	}
	if !result.OK && !closedCode(result.Error) {
		return fail(ErrInvalidRequest, "unknown result error %q", result.Error)
	}
	return nil
}

func closedCode(code ErrorCode) bool {
	switch code {
	case ErrContainmentUnavailable, ErrInvalidFrame, ErrInvalidRequest, ErrReplay, ErrWorkerCrash, ErrTimeout, ErrAborted:
		return true
	}
	return false
}

func isHex(value string) bool { _, err := hex.DecodeString(value); return err == nil }

type Limits struct {
	MemoryMax       int64
	TasksMax        int
	CPUQuotaPercent int
	RuntimeMax      time.Duration
}

func (l Limits) Clamp() Limits {
	if l.MemoryMax <= 0 || l.MemoryMax > MemoryCeiling {
		l.MemoryMax = MemoryCeiling
	}
	if l.TasksMax <= 0 || l.TasksMax > TasksCeiling {
		l.TasksMax = TasksCeiling
	}
	if l.CPUQuotaPercent <= 0 || l.CPUQuotaPercent > CPUQuotaPercent {
		l.CPUQuotaPercent = CPUQuotaPercent
	}
	if l.RuntimeMax <= 0 || l.RuntimeMax > RuntimeCeiling {
		l.RuntimeMax = RuntimeCeiling
	}
	return l
}

type ServiceSpec struct {
	Command                                                  []string
	Environment                                              []string
	InputDirectory, RuntimeDirectory, TempDirectory          string
	MemoryMax, MemorySwapMax                                 int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec            int
	RuntimeMax                                               time.Duration
	KillMode                                                 string
	NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome bool
	ProtectSystem                                            string
	CapabilityBoundingSet                                    []string
	ReadOnlyPaths, ReadWritePaths                            []string
}

func NewServiceSpec(input, runtime, temporary string, requested Limits) (ServiceSpec, error) {
	for _, path := range []string{input, runtime, temporary} {
		if !filepath.IsAbs(path) {
			return ServiceSpec{}, fail(ErrInvalidRequest, "sandbox path must be absolute")
		}
	}
	limits := requested.Clamp()
	return ServiceSpec{Command: []string{"/usr/lib/crux/anydoc-runner"}, Environment: []string{"LANG=C", "PATH=/usr/bin:/bin"}, InputDirectory: input, RuntimeDirectory: runtime, TempDirectory: temporary, MemoryMax: limits.MemoryMax, MemorySwapMax: 0, TasksMax: limits.TasksMax, CPUQuotaPercent: limits.CPUQuotaPercent, CPUQuotaPeriodUSec: CPUPeriodUSec, RuntimeMax: limits.RuntimeMax, KillMode: "control-group", NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectSystem: "strict", ProtectHome: true, CapabilityBoundingSet: []string{}, ReadOnlyPaths: []string{input, runtime}, ReadWritePaths: []string{temporary}}, nil
}

type SandboxReport struct {
	MainPID                                                  int
	ControlGroupMembers                                      []int
	MemoryMax, MemorySwapMax                                 int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec            int
	RuntimeMax                                               time.Duration
	KillMode                                                 string
	NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome bool
	ProtectSystem                                            string
	CapabilityBoundingSet                                    []string
	ReadOnlyPaths, ReadWritePaths                            []string
	Populated                                                bool
}
type Unit interface {
	Report(context.Context) (SandboxReport, error)
	ReleaseCapabilityFD(context.Context, string, string) (int, error)
	Stop(context.Context) error
	WaitInactive(context.Context) error
	Cleanup(context.Context) error
}
type Backend interface {
	Start(context.Context, ServiceSpec) (Unit, error)
}

type Capability struct {
	Version                                                               int
	VerifiedBy                                                            string
	FilesystemRead, FilesystemWrite, OutboundNetwork, PrivilegeEscalation string
}

type capabilityWire struct {
	Version             int    `json:"version"`
	VerifiedBy          string `json:"verifiedBy"`
	FilesystemRead      string `json:"filesystemRead"`
	FilesystemWrite     string `json:"filesystemWrite"`
	OutboundNetwork     string `json:"outboundNetwork"`
	PrivilegeEscalation string `json:"privilegeEscalation"`
}

func EncodeCapability(w io.Writer, capability Capability) error {
	if !validCapability(capability) {
		return fail(ErrInvalidRequest, "invalid containment capability")
	}
	payload, err := json.Marshal(capabilityWire{capability.Version, capability.VerifiedBy, capability.FilesystemRead, capability.FilesystemWrite, capability.OutboundNetwork, capability.PrivilegeEscalation})
	if err != nil {
		return fail(ErrInvalidFrame, "encode capability")
	}
	if len(payload) == 0 || len(payload) > MaxFrameBytes {
		return fail(ErrInvalidFrame, "invalid capability frame length")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := w.Write(header[:]); err != nil {
		return err
	}
	_, err = w.Write(payload)
	return err
}

func DecodeCapability(r io.Reader) (Capability, error) {
	var header [4]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Capability{}, fail(ErrInvalidFrame, "read capability header: %v", err)
	}
	size := binary.BigEndian.Uint32(header[:])
	if size == 0 || size > MaxFrameBytes {
		return Capability{}, fail(ErrInvalidFrame, "invalid capability frame length %d", size)
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(r, payload); err != nil {
		return Capability{}, fail(ErrInvalidFrame, "truncated capability frame: %v", err)
	}
	var extra [1]byte
	if n, err := r.Read(extra[:]); n != 0 || (err != nil && !errors.Is(err, io.EOF)) {
		return Capability{}, fail(ErrInvalidFrame, "extra data after capability frame")
	}
	var wire capabilityWire
	if err := json.Unmarshal(payload, &wire); err != nil {
		return Capability{}, fail(ErrInvalidFrame, "invalid capability json")
	}
	capability := Capability{wire.Version, wire.VerifiedBy, wire.FilesystemRead, wire.FilesystemWrite, wire.OutboundNetwork, wire.PrivilegeEscalation}
	if !validCapability(capability) {
		return Capability{}, fail(ErrInvalidRequest, "invalid containment capability")
	}
	return capability, nil
}

func validCapability(capability Capability) bool {
	return capability.Version == ProtocolVersion && capability.VerifiedBy == "host-supervisor" && capability.FilesystemRead == "input-only" && capability.FilesystemWrite == "private-temp-only" && capability.OutboundNetwork == "denied" && capability.PrivilegeEscalation == "denied"
}

type Run struct {
	unit          Unit
	nonce, digest string
	capability    Capability
	done          bool
}
type Supervisor struct{ backend Backend }

func New(backend Backend) *Supervisor { return &Supervisor{backend: backend} }

func (s *Supervisor) Start(ctx context.Context, input []byte, inputDirectory, runtimeDirectory, tempDirectory string, requested Limits) (*Run, error) {
	if s == nil || s.backend == nil {
		return nil, fail(ErrContainmentUnavailable, "supervisor backend unavailable")
	}
	spec, err := NewServiceSpec(inputDirectory, runtimeDirectory, tempDirectory, requested)
	if err != nil {
		return nil, err
	}
	unit, err := s.backend.Start(ctx, spec)
	if err != nil {
		return nil, fail(ErrContainmentUnavailable, "start transient unit: %v", err)
	}
	if err := verify(ctx, unit, spec); err != nil {
		_ = closeUnit(ctx, unit)
		return nil, err
	}
	nonce, err := newNonce()
	if err != nil {
		_ = closeUnit(ctx, unit)
		return nil, fail(ErrContainmentUnavailable, "nonce generation failed")
	}
	digest := sha256.Sum256(input)
	run := &Run{unit: unit, nonce: nonce, digest: hex.EncodeToString(digest[:]), capability: Capability{Version: 1, VerifiedBy: "host-supervisor", FilesystemRead: "input-only", FilesystemWrite: "private-temp-only", OutboundNetwork: "denied", PrivilegeEscalation: "denied"}}
	if _, err := unit.ReleaseCapabilityFD(ctx, run.nonce, run.digest); err != nil {
		_ = closeUnit(ctx, unit)
		return nil, fail(ErrContainmentUnavailable, "release capability: %v", err)
	}
	return run, nil
}
func (r *Run) Capability() Capability { return r.capability }
func (r *Run) Authorize(request Request) error {
	if r == nil || r.done {
		return fail(ErrReplay, "run is closed")
	}
	if err := validateRequest(request); err != nil {
		return err
	}
	if request.Nonce != r.nonce || request.Digest != r.digest {
		return fail(ErrReplay, "request does not match capability")
	}
	r.done = true
	return nil
}
func (r *Run) Finish(ctx context.Context, outcome error) error {
	if r == nil {
		return nil
	}
	r.done = true
	if err := closeUnit(ctx, r.unit); err != nil {
		return err
	}
	if errors.Is(outcome, context.DeadlineExceeded) {
		return fail(ErrTimeout, "worker exceeded runtime limit")
	}
	if errors.Is(outcome, context.Canceled) {
		return fail(ErrAborted, "run aborted")
	}
	if outcome != nil {
		return fail(ErrWorkerCrash, "worker terminated: %v", outcome)
	}
	return nil
}
func newNonce() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}
func closeUnit(ctx context.Context, unit Unit) error {
	if unit == nil {
		return nil
	}
	var joined error
	if err := unit.Stop(ctx); err != nil {
		joined = errors.Join(joined, err)
	}
	if err := unit.WaitInactive(ctx); err != nil {
		joined = errors.Join(joined, err)
	}
	if err := unit.Cleanup(ctx); err != nil {
		joined = errors.Join(joined, err)
	}
	return joined
}
func verify(ctx context.Context, unit Unit, spec ServiceSpec) error {
	report, err := unit.Report(ctx)
	if err != nil {
		return fail(ErrContainmentUnavailable, "inspect transient unit: %v", err)
	}
	if report.MainPID <= 0 || !contains(report.ControlGroupMembers, report.MainPID) || report.MemoryMax != spec.MemoryMax || report.MemorySwapMax != 0 || report.TasksMax != spec.TasksMax || report.CPUQuotaPercent != spec.CPUQuotaPercent || report.CPUQuotaPeriodUSec != spec.CPUQuotaPeriodUSec || report.RuntimeMax != spec.RuntimeMax || report.KillMode != "control-group" || !report.NoNewPrivileges || !report.PrivateNetwork || !report.PrivateTmp || report.ProtectSystem != "strict" || !report.ProtectHome || len(report.CapabilityBoundingSet) != 0 || !samePaths(report.ReadOnlyPaths, spec.ReadOnlyPaths) || !samePaths(report.ReadWritePaths, spec.ReadWritePaths) {
		return fail(ErrContainmentUnavailable, "transient unit verification failed")
	}
	return nil
}
func contains(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func samePaths(a, b []string) bool { return strings.Join(a, "\x00") == strings.Join(b, "\x00") }
