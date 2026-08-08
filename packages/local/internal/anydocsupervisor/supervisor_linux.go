//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	ProtocolVersion = 1
	MaxFrameBytes   = 8 << 20
	MemoryCeiling   = 512 << 20
	TasksCeiling    = 64
	// This caps aggregate cgroup CPU at 18 seconds during RuntimeCeiling.
	CPUQuotaPercent = 60
	CPUPeriodUSec   = 1_000_000
	RuntimeCeiling  = 30 * time.Second
	CPUCeiling      = 20 * time.Second
	usageTimeout    = 100 * time.Millisecond
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

type SupervisorError struct{ Code ErrorCode }

func (e *SupervisorError) Error() string { return string(e.Code) }
func closed(code ErrorCode) error        { return &SupervisorError{Code: code} }

var errCPUAccounting = errors.New("cpu accounting unavailable")

type Request struct {
	Version       int       `json:"version"`
	Nonce         string    `json:"nonce"`
	RequestDigest string    `json:"requestDigest"`
	Format        string    `json:"format"`
	SourceSHA256  string    `json:"sourceSha256"`
	SourceBytes   int64     `json:"sourceBytes"`
	Limits        JobLimits `json:"limits"`
}
type JobLimits struct {
	SourceBytes int64 `json:"sourceBytes"`
	ResultBytes int64 `json:"resultBytes"`
}
type Result struct {
	Request
	OK         bool              `json:"ok"`
	Error      ErrorCode         `json:"error,omitempty"`
	Payload    []byte            `json:"payload,omitempty"`
	Accounting *ResultAccounting `json:"accounting,omitempty"`
}
type ResultAccounting struct {
	SourceBytes int64 `json:"sourceBytes"`
}

func validRequest(v Request) bool {
	return v.Version == ProtocolVersion && len(v.Nonce) == 32 && len(v.RequestDigest) == 64 && len(v.SourceSHA256) == 64 && hexOK(v.Nonce) && hexOK(v.RequestDigest) && hexOK(v.SourceSHA256) && validFormat(v.Format) && v.SourceBytes >= 0 && v.Limits.SourceBytes >= v.SourceBytes && v.Limits.SourceBytes <= MaxFrameBytes*8 && v.Limits.ResultBytes > 0 && v.Limits.ResultBytes <= MaxFrameBytes
}
func validFormat(format string) bool {
	switch format {
	case "doc", "docm", "rtf", "odt", "epub", "ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm", "odp", "docx", "xls", "xlsb", "ods":
		return true
	}
	return false
}
func hexOK(s string) bool { _, e := hex.DecodeString(s); return e == nil }
func writeFull(w io.Writer, p []byte) error {
	for len(p) > 0 {
		n, e := w.Write(p)
		if e != nil {
			return e
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		p = p[n:]
	}
	return nil
}
func writeFrame(w io.Writer, value any) error {
	p, e := json.Marshal(value)
	if e != nil || len(p) == 0 || len(p) > MaxFrameBytes {
		return closed(ErrInvalidFrame)
	}
	var h [4]byte
	binary.BigEndian.PutUint32(h[:], uint32(len(p)))
	if e = writeFull(w, h[:]); e != nil {
		return e
	}
	return writeFull(w, p)
}
func readFrame(r io.Reader, dst any) error {
	var h [4]byte
	if _, e := io.ReadFull(r, h[:]); e != nil {
		return closed(ErrInvalidFrame)
	}
	n := binary.BigEndian.Uint32(h[:])
	if n == 0 || n > MaxFrameBytes {
		return closed(ErrInvalidFrame)
	}
	p := make([]byte, n)
	if _, e := io.ReadFull(r, p); e != nil {
		return closed(ErrInvalidFrame)
	}
	d := json.NewDecoder(bytes.NewReader(p))
	d.DisallowUnknownFields()
	if e := d.Decode(dst); e != nil {
		return closed(ErrInvalidFrame)
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return closed(ErrInvalidFrame)
	}
	return nil
}
func EncodeRequest(w io.Writer, v Request) error {
	if !validRequest(v) {
		return closed(ErrInvalidRequest)
	}
	e := writeFrame(w, v)
	if e != nil {
		return closed(ErrInvalidFrame)
	}
	return nil
}
func DecodeRequest(r io.Reader) (Request, error) {
	var v Request
	e := readFrame(r, &v)
	if e != nil {
		return v, e
	}
	if !validRequest(v) {
		return v, closed(ErrInvalidRequest)
	}
	return v, nil
}
func EncodeResult(w io.Writer, v Result) error {
	if !validResult(v) {
		return closed(ErrInvalidRequest)
	}
	if e := writeFrame(w, v); e != nil {
		return closed(ErrInvalidFrame)
	}
	return nil
}
func DecodeResult(r io.Reader) (Result, error) {
	var v Result
	e := readFrame(r, &v)
	if e != nil {
		return v, e
	}
	if !validResult(v) {
		return v, closed(ErrInvalidRequest)
	}
	return v, nil
}
func validResult(v Result) bool {
	if !validRequest(v.Request) {
		return false
	}
	if v.OK {
		return v.Error == "" && len(v.Payload) > 0 && v.Accounting != nil && v.Accounting.SourceBytes == v.SourceBytes
	}
	return v.Error != "" && known(v.Error) && len(v.Payload) == 0 && v.Accounting == nil
}
func known(c ErrorCode) bool {
	switch c {
	case ErrContainmentUnavailable, ErrInvalidFrame, ErrInvalidRequest, ErrReplay, ErrWorkerCrash, ErrTimeout, ErrAborted:
		return true
	}
	return false
}

type Limits struct {
	MemoryMax                 int64
	TasksMax, CPUQuotaPercent int
	RuntimeMax                time.Duration
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
	Command, Environment, ReadOnlyPaths, ReadWritePaths, RestrictAddressFamilies []string
	MemoryMax, MemorySwapMax                                                     int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec                                int
	RuntimeMax                                                                   time.Duration
	KillMode, ProtectSystem                                                      string
	CPUAccounting, NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome      bool
}

func NewServiceSpec(input, runtime, tmp string, l Limits) (ServiceSpec, error) {
	paths := []string{input, runtime, tmp}
	for _, p := range paths {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p {
			return ServiceSpec{}, closed(ErrInvalidRequest)
		}
	}
	for i, p := range paths {
		for j, q := range paths {
			if i != j && (p == q || len(p) < len(q) && q[:len(p)+1] == p+"/") {
				return ServiceSpec{}, closed(ErrInvalidRequest)
			}
		}
	}
	l = l.Clamp()
	return ServiceSpec{Command: []string{"/usr/lib/crux/anydoc-runner"}, Environment: []string{"LANG=C", "PATH=/usr/bin:/bin"}, ReadOnlyPaths: []string{input, runtime}, ReadWritePaths: []string{tmp}, RestrictAddressFamilies: []string{"AF_UNIX"}, MemoryMax: l.MemoryMax, MemorySwapMax: 0, TasksMax: l.TasksMax, CPUQuotaPercent: l.CPUQuotaPercent, CPUQuotaPeriodUSec: CPUPeriodUSec, RuntimeMax: l.RuntimeMax, KillMode: "control-group", ProtectSystem: "strict", CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true}, nil
}

type SandboxReport struct {
	MainPID                                                                 int
	ControlGroupMembers                                                     []int
	MemoryMax, MemorySwapMax                                                int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec                           int
	RuntimeMax                                                              time.Duration
	KillMode, ProtectSystem                                                 string
	CPUAccounting, NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome bool
	ReadOnlyPaths, ReadWritePaths, RestrictAddressFamilies                  []string
	CapabilityBoundingSet, AmbientCapabilities                              uint64
	RestrictAddressFamiliesAllow                                            bool
	DynamicUser                                                             bool
	UID                                                                     uint64
	PrivateUsers                                                            bool
	ProtectProc, ProcSubset                                                 string
	Populated                                                               bool
}
type Unit interface {
	Report(context.Context) (SandboxReport, error)
	CPUUsage(context.Context) (time.Duration, error)
	Stop(context.Context) error
	WaitInactive(context.Context) error
	Cleanup(context.Context) error
}
type Backend interface {
	Start(context.Context, ServiceSpec, *os.File) (Unit, error)
}
type capabilityAuthorizer interface {
	AuthorizeCapability(context.Context, Request) error
}
type resultReceiver interface {
	ReceiveResult(context.Context) (Result, error)
}
type authorizationPreparer interface{ PrepareAuthorization(context.Context) error }
type verifiedServiceSpec interface {
	VerifiedServiceSpec(ServiceSpec) ServiceSpec
}
type PipeFactory func() (*os.File, *os.File, error)
type Supervisor struct {
	backend Backend
	pipe    PipeFactory
	now     func() time.Time
}

func New(b Backend) *Supervisor { return &Supervisor{backend: b, pipe: os.Pipe, now: time.Now} }

type Run struct {
	unit          Unit
	write         *os.File
	nonce, digest string
	sourceBytes   int64
	mu            sync.Mutex
	stopOnce      sync.Once
	finishOnce    sync.Once
	finished      chan struct{}
	result        error
	done          bool
	stop          chan struct{}
}

func (s *Supervisor) Start(ctx context.Context, input []byte, a, b, c string, l Limits) (*Run, error) {
	if s == nil || s.backend == nil {
		return nil, closed(ErrContainmentUnavailable)
	}
	spec, e := NewServiceSpec(a, b, c, l)
	if e != nil {
		return nil, e
	}
	read, write, e := s.pipe()
	if e != nil {
		return nil, closed(ErrContainmentUnavailable)
	}
	unit, e := s.backend.Start(ctx, spec, read)
	if e != nil {
		read.Close()
		write.Close()
		return nil, closed(ErrContainmentUnavailable)
	}
	if adjusted, ok := unit.(verifiedServiceSpec); ok {
		spec = adjusted.VerifiedServiceSpec(spec)
	}
	if !verify(ctx, unit, spec) {
		write.Close()
		cleanup(unit)
		return nil, closed(ErrContainmentUnavailable)
	}
	if preparer, ok := unit.(authorizationPreparer); ok {
		if preparer.PrepareAuthorization(ctx) != nil {
			write.Close()
			cleanup(unit)
			return nil, closed(ErrContainmentUnavailable)
		}
	}
	var n [16]byte
	if _, e = rand.Read(n[:]); e != nil {
		write.Close()
		cleanup(unit)
		return nil, closed(ErrContainmentUnavailable)
	}
	d := sha256.Sum256(input)
	r := &Run{unit: unit, write: write, nonce: hex.EncodeToString(n[:]), digest: hex.EncodeToString(d[:]), sourceBytes: int64(len(input)), stop: make(chan struct{}), finished: make(chan struct{})}
	go r.monitor()
	return r, nil
}
func (r *Run) Authorize() error {
	if r == nil {
		return closed(ErrReplay)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return closed(ErrReplay)
	}
	r.done = true
	v := Request{Version: ProtocolVersion, Nonce: r.nonce, RequestDigest: r.digest, SourceSHA256: r.digest, Format: "docx", SourceBytes: r.sourceBytes, Limits: JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}}
	var e error
	if authorizer, ok := r.unit.(capabilityAuthorizer); ok {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		e = authorizer.AuthorizeCapability(ctx, v)
		cancel()
	} else {
		e = EncodeRequest(r.write, v)
	}
	closeErr := r.write.Close()
	if e != nil || closeErr != nil {
		return closed(ErrContainmentUnavailable)
	}
	return nil
}

// ReceiveResult accepts exactly one authenticated worker result, acknowledges
// it, and leaves lifecycle cleanup to Finish.
func (r *Run) ReceiveResult(ctx context.Context) (Result, error) {
	if r == nil {
		return Result{}, closed(ErrReplay)
	}
	receiver, ok := r.unit.(resultReceiver)
	if !ok {
		return Result{}, closed(ErrContainmentUnavailable)
	}
	result, err := receiver.ReceiveResult(ctx)
	if err != nil {
		return Result{}, closed(ErrWorkerCrash)
	}
	if result.Nonce != r.nonce || result.RequestDigest != r.digest || result.SourceSHA256 != r.digest || result.SourceBytes != r.sourceBytes || result.Format != "docx" {
		return Result{}, closed(ErrReplay)
	}
	return result, nil
}

// Execute receives the one permitted result and always tears down its unit.
func (r *Run) Execute(ctx context.Context) (Result, error) {
	result, err := r.ReceiveResult(ctx)
	finishErr := r.Finish(ctx, err)
	if finishErr != nil {
		return Result{}, finishErr
	}
	return result, err
}
func (r *Run) Finish(_ context.Context, out error) error {
	if r == nil {
		return closed(ErrReplay)
	}
	r.finishOnce.Do(func() {
		r.mu.Lock()
		r.done = true
		_ = r.write.Close()
		r.stopOnce.Do(func() { close(r.stop) })
		r.mu.Unlock()
		result := outcomeCode(out)
		if !cleanup(r.unit) {
			result = closed(ErrContainmentUnavailable)
		}
		r.mu.Lock()
		r.result = result
		r.mu.Unlock()
		close(r.finished)
	})
	<-r.finished
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.result
}
func outcomeCode(out error) error {
	if errors.Is(out, errCPUAccounting) {
		return closed(ErrContainmentUnavailable)
	}
	if errors.Is(out, context.DeadlineExceeded) {
		return closed(ErrTimeout)
	}
	if errors.Is(out, context.Canceled) {
		return closed(ErrAborted)
	}
	if out != nil {
		return closed(ErrWorkerCrash)
	}
	return nil
}
func (r *Run) monitor() {
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-tick.C:
			ctx, cancel := context.WithTimeout(context.Background(), usageTimeout)
			u, e := r.unit.CPUUsage(ctx)
			cancel()
			if e != nil {
				r.Finish(context.Background(), errCPUAccounting)
				return
			}
			if u >= CPUCeiling {
				r.Finish(context.Background(), context.DeadlineExceeded)
				return
			}
		}
	}
}
func cleanup(unit Unit) bool {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if unit == nil {
		return false
	}
	ok := true
	if unit.Stop(ctx) != nil {
		ok = false
	}
	if unit.WaitInactive(ctx) != nil {
		ok = false
	}
	report, err := unit.Report(ctx)
	if err != nil || report.Populated {
		ok = false
	}
	if unit.Cleanup(ctx) != nil {
		ok = false
	}
	return ok
}
func verify(ctx context.Context, u Unit, s ServiceSpec) bool {
	if u == nil {
		return false
	}
	r, e := u.Report(ctx)
	if e != nil {
		return false
	}
	return r.MainPID > 0 && r.UID > 0 && r.DynamicUser && r.PrivateUsers && r.ProtectProc == "invisible" && r.ProcSubset == "pid" && contains(r.ControlGroupMembers, r.MainPID) && r.MemoryMax == s.MemoryMax && r.MemorySwapMax == 0 && r.TasksMax == s.TasksMax && r.CPUQuotaPercent == s.CPUQuotaPercent && r.CPUQuotaPeriodUSec == s.CPUQuotaPeriodUSec && r.RuntimeMax == s.RuntimeMax && r.KillMode == s.KillMode && r.ProtectSystem == "strict" && r.CPUAccounting && r.NoNewPrivileges && r.PrivateNetwork && r.PrivateTmp && r.ProtectHome && r.CapabilityBoundingSet == 0 && r.AmbientCapabilities == 0 && r.RestrictAddressFamiliesAllow && same(r.ReadOnlyPaths, s.ReadOnlyPaths) && same(r.ReadWritePaths, s.ReadWritePaths) && same(r.RestrictAddressFamilies, s.RestrictAddressFamilies)
}
func contains(a []int, x int) bool {
	for _, v := range a {
		if v == x {
			return true
		}
	}
	return false
}
func same(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
