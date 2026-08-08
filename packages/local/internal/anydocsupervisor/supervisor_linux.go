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

	"github.com/use-crux/crux/packages/local/internal/assets"
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
	runtimeTarget   = "/run/crux-anydoc/runtime"
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
	return v.Version == ProtocolVersion && len(v.Nonce) == 32 && len(v.RequestDigest) == 64 && len(v.SourceSHA256) == 64 && hexOK(v.Nonce) && hexOK(v.RequestDigest) && hexOK(v.SourceSHA256) && validFormat(v.Format) && v.SourceBytes >= 0 && v.Limits.SourceBytes >= v.SourceBytes && v.Limits.SourceBytes <= MaxFrameBytes*8 && v.Limits.ResultBytes > 0 && v.Limits.ResultBytes <= MaxFrameBytes && v.RequestDigest == requestDigest(v.Version, v.Nonce, v.Format, v.SourceSHA256, v.SourceBytes, v.Limits)
}

// requestDigest is SHA-256 over this language-independent encoding:
// "crux-anydoc-job-digest-v1\\x00", u32be(version), u32be(len(nonce)), nonce,
// u32be(len(format)), format, u32be(len(sourceSha256)), sourceSha256,
// u64be(sourceBytes), u64be(limits.sourceBytes), u64be(limits.resultBytes).
func requestDigest(version int, nonce, format, sourceSHA256 string, sourceBytes int64, limits JobLimits) string {
	h := sha256.New()
	_, _ = h.Write([]byte("crux-anydoc-job-digest-v1\x00"))
	var word [8]byte
	binary.BigEndian.PutUint32(word[:4], uint32(version))
	_, _ = h.Write(word[:4])
	for _, field := range []string{nonce, format, sourceSHA256} {
		binary.BigEndian.PutUint32(word[:4], uint32(len(field)))
		_, _ = h.Write(word[:4])
		_, _ = h.Write([]byte(field))
	}
	for _, value := range []int64{sourceBytes, limits.SourceBytes, limits.ResultBytes} {
		binary.BigEndian.PutUint64(word[:], uint64(value))
		_, _ = h.Write(word[:])
	}
	return hex.EncodeToString(h.Sum(nil))
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
		return v.Error == "" && len(v.Payload) > 0 && int64(len(v.Payload)) <= v.Limits.ResultBytes && v.Accounting != nil && v.Accounting.SourceBytes == v.SourceBytes
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
	Command, Environment, ReadOnlyPaths, BindReadOnlyPaths, ReadWritePaths, RestrictAddressFamilies []string
	MemoryMax, MemorySwapMax                                                                        int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec                                                   int
	RuntimeMax                                                                                      time.Duration
	KillMode, ProtectSystem                                                                         string
	CPUAccounting, NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome                         bool
	NodeSHA256                                                                                      string
	Node                                                                                            assets.AttestedNode
	runtimeTreeDigest                                                                               string
}

type LaunchDependency struct {
	runtimeRoot, runtimeRunner, runtimeTreeDigest string
	node                                          assets.AttestedNode
	nodePath, nodeSHA256                          string
}

// PrepareLocalHost materializes and attests the dormant Anydoc launch inputs.
// It intentionally does not register a route or enable any document format.
func PrepareLocalHost() (LaunchDependency, error) {
	runtime, err := assets.ExtractEmbeddedAnydocRuntime()
	if err != nil {
		return LaunchDependency{}, closed(ErrContainmentUnavailable)
	}
	node, err := assets.ResolveAnydocNode()
	if err != nil {
		return LaunchDependency{}, closed(ErrContainmentUnavailable)
	}
	return newLaunchDependency(runtime, node)
}

func newLaunchDependency(runtime assets.InstalledAnydocRuntime, node assets.AttestedNode) (LaunchDependency, error) {
	if runtime.Root() == "" || runtime.Runner() != filepath.Join(runtime.Root(), "runner.mjs") || len(runtime.Digest()) != sha256.Size*2 || node.Path() == "" || len(node.SHA256()) != sha256.Size*2 {
		return LaunchDependency{}, closed(ErrContainmentUnavailable)
	}
	return LaunchDependency{runtimeRoot: runtime.Root(), runtimeRunner: runtime.Runner(), runtimeTreeDigest: runtime.Digest(), node: node, nodePath: node.Path(), nodeSHA256: node.SHA256()}, nil
}

func newServiceSpec(hostSource, runtime, tmp, nodePath, nodeSHA256 string, node assets.AttestedNode, digest string, l Limits) (ServiceSpec, error) {
	paths := []string{hostSource, runtime, tmp}
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
	runner := filepath.Join(runtimeTarget, "runner.mjs")
	return ServiceSpec{Command: []string{nodePath, runner}, NodeSHA256: nodeSHA256, Node: node, runtimeTreeDigest: digest, Environment: []string{"LANG=C", "PATH=/usr/bin:/bin"}, BindReadOnlyPaths: []string{runtime + ":" + runtimeTarget, hostSource + ":" + stagedSourceTarget}, ReadWritePaths: []string{tmp}, RestrictAddressFamilies: []string{"AF_UNIX"}, MemoryMax: l.MemoryMax, MemorySwapMax: 0, TasksMax: l.TasksMax, CPUQuotaPercent: l.CPUQuotaPercent, CPUQuotaPeriodUSec: CPUPeriodUSec, RuntimeMax: l.RuntimeMax, KillMode: "control-group", ProtectSystem: "strict", CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true}, nil
}

// NewInstalledServiceSpec binds containment to a runtime minted by assets,
// rather than accepting a caller-controlled runner path.
func NewInstalledServiceSpec(hostSource string, runtime assets.InstalledAnydocRuntime, node assets.AttestedNode, tmp string, l Limits) (ServiceSpec, error) {
	launch, err := newLaunchDependency(runtime, node)
	if err != nil {
		return ServiceSpec{}, err
	}
	return serviceSpec(hostSource, launch, tmp, l)
}

func serviceSpec(hostSource string, launch LaunchDependency, tmp string, l Limits) (ServiceSpec, error) {
	if launch.runtimeRoot == "" || launch.runtimeRunner != filepath.Join(launch.runtimeRoot, "runner.mjs") || launch.nodePath == "" || len(launch.nodeSHA256) != sha256.Size*2 || len(launch.runtimeTreeDigest) != sha256.Size*2 {
		return ServiceSpec{}, closed(ErrContainmentUnavailable)
	}
	return newServiceSpec(hostSource, launch.runtimeRoot, tmp, launch.nodePath, launch.nodeSHA256, launch.node, launch.runtimeTreeDigest, l)
}

type SandboxReport struct {
	MainPID                                                                   int
	ControlGroupMembers                                                       []int
	MemoryMax, MemorySwapMax                                                  int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec                             int
	RuntimeMax                                                                time.Duration
	KillMode, ProtectSystem                                                   string
	CPUAccounting, NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome   bool
	ReadOnlyPaths, BindReadOnlyPaths, ReadWritePaths, RestrictAddressFamilies []string
	CapabilityBoundingSet, AmbientCapabilities                                uint64
	RestrictAddressFamiliesAllow                                              bool
	DynamicUser                                                               bool
	UID                                                                       uint64
	PrivateUsers                                                              bool
	ProtectProc, ProcSubset                                                   string
	Populated                                                                 bool
	MemoryCurrent                                                             int64
	MemoryEvents                                                              map[string]int64
	RuntimeTreeDigest                                                         string
}
type TerminalReport struct {
	Sandbox SandboxReport
	CPU     time.Duration
	Wall    time.Duration
	Outcome ErrorCode
	Cleaned bool
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
	ReceiveResult(context.Context, Request) (Result, error)
}
type authorizationPreparer interface{ PrepareAuthorization(context.Context) error }
type verifiedServiceSpec interface {
	VerifiedServiceSpec(ServiceSpec) ServiceSpec
}
type attestedNodeVerifier interface {
	VerifyAttestedNode(context.Context, assets.AttestedNode) error
}
type PipeFactory func() (*os.File, *os.File, error)
type Supervisor struct {
	backend Backend
	stager  *Stager
	pipe    PipeFactory
	now     func() time.Time
}

func New(b Backend) *Supervisor { return NewWithStager(b, NewStager("/run/crux-anydoc/input")) }
func NewWithStager(b Backend, stager *Stager) *Supervisor {
	return &Supervisor{backend: b, stager: stager, pipe: os.Pipe, now: time.Now}
}

type Run struct {
	unit          Unit
	write         *os.File
	nonce, digest string
	sourceSHA     string
	sourceBytes   int64
	limits        JobLimits
	staged        *StagedSource
	mu            sync.Mutex
	stopOnce      sync.Once
	finishOnce    sync.Once
	finished      chan struct{}
	result        error
	terminal      TerminalReport
	started       time.Time
	done          bool
	stop          chan struct{}
}

func (s *Supervisor) Start(ctx context.Context, input []byte, launch LaunchDependency, tmp string, l Limits) (*Run, error) {
	if s == nil || s.backend == nil || s.stager == nil {
		return nil, closed(ErrContainmentUnavailable)
	}
	limits := JobLimits{SourceBytes: MaxFrameBytes * 8, ResultBytes: MaxFrameBytes}
	staged, e := s.stager.Stage(input, limits.SourceBytes)
	if e != nil {
		return nil, closed(ErrInvalidRequest)
	}
	spec, e := serviceSpec(staged.HostPath, launch, tmp, l)
	if e != nil {
		_ = staged.Cleanup()
		return nil, e
	}
	read, write, e := s.pipe()
	if e != nil {
		_ = staged.Cleanup()
		return nil, closed(ErrContainmentUnavailable)
	}
	unit, e := s.backend.Start(ctx, spec, read)
	if e != nil {
		read.Close()
		write.Close()
		_ = staged.Cleanup()
		return nil, closed(ErrContainmentUnavailable)
	}
	if adjusted, ok := unit.(verifiedServiceSpec); ok {
		spec = adjusted.VerifiedServiceSpec(spec)
	}
	if !verify(ctx, unit, spec) {
		write.Close()
		_ = staged.Cleanup()
		_, _, _ = cleanup(unit)
		return nil, closed(ErrContainmentUnavailable)
	}
	if preparer, ok := unit.(authorizationPreparer); ok {
		if preparer.PrepareAuthorization(ctx) != nil {
			write.Close()
			_ = staged.Cleanup()
			_, _, _ = cleanup(unit)
			return nil, closed(ErrContainmentUnavailable)
		}
	}
	var n [16]byte
	if _, e = rand.Read(n[:]); e != nil {
		write.Close()
		_ = staged.Cleanup()
		_, _, _ = cleanup(unit)
		return nil, closed(ErrContainmentUnavailable)
	}
	d := sha256.Sum256(input)
	nonce := hex.EncodeToString(n[:])
	sourceSHA := hex.EncodeToString(d[:])
	r := &Run{unit: unit, write: write, nonce: nonce, digest: requestDigest(ProtocolVersion, nonce, "docx", sourceSHA, int64(len(input)), limits), sourceSHA: sourceSHA, sourceBytes: int64(len(input)), limits: limits, staged: staged, stop: make(chan struct{}), finished: make(chan struct{}), started: s.now()}
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
	v := Request{Version: ProtocolVersion, Nonce: r.nonce, RequestDigest: r.digest, SourceSHA256: r.sourceSHA, Format: "docx", SourceBytes: r.sourceBytes, Limits: r.limits}
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
	expected := Request{Version: ProtocolVersion, Nonce: r.nonce, RequestDigest: r.digest, Format: "docx", SourceSHA256: r.sourceSHA, SourceBytes: r.sourceBytes, Limits: r.limits}
	result, err := receiver.ReceiveResult(ctx, expected)
	if err != nil {
		return Result{}, closed(ErrWorkerCrash)
	}
	if result.Request != expected {
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
		report, cpu, cleaned := cleanup(r.unit)
		if !cleaned {
			result = closed(ErrContainmentUnavailable)
		}
		if r.staged == nil || r.staged.Cleanup() != nil {
			result = closed(ErrContainmentUnavailable)
		}
		r.terminal = TerminalReport{Sandbox: report, CPU: cpu, Wall: time.Since(r.started), Outcome: errorCode(result), Cleaned: cleaned && r.staged != nil && r.staged.cleanup == nil}
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
func (r *Run) TerminalReport() TerminalReport {
	if r == nil {
		return TerminalReport{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.terminal
}
func errorCode(err error) ErrorCode {
	var e *SupervisorError
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
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
func cleanup(unit Unit) (SandboxReport, time.Duration, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if unit == nil {
		return SandboxReport{}, 0, false
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
	cpu, cpuErr := unit.CPUUsage(ctx)
	if cpuErr != nil {
		ok = false
	}
	if unit.Cleanup(ctx) != nil {
		ok = false
	}
	return report, cpu, ok
}
func verify(ctx context.Context, u Unit, s ServiceSpec) bool {
	if u == nil {
		return false
	}
	r, e := u.Report(ctx)
	if e != nil {
		return false
	}
	if verifier, ok := u.(attestedNodeVerifier); ok {
		if err := verifier.VerifyAttestedNode(ctx, s.Node); err != nil {
			return false
		}
	}
	return r.MainPID > 0 && r.RuntimeTreeDigest == s.runtimeTreeDigest && r.UID > 0 && r.DynamicUser && r.PrivateUsers && r.ProtectProc == "invisible" && r.ProcSubset == "pid" && contains(r.ControlGroupMembers, r.MainPID) && r.MemoryMax == s.MemoryMax && r.MemorySwapMax == 0 && r.TasksMax == s.TasksMax && r.CPUQuotaPercent == s.CPUQuotaPercent && r.CPUQuotaPeriodUSec == s.CPUQuotaPeriodUSec && r.RuntimeMax == s.RuntimeMax && r.KillMode == s.KillMode && r.ProtectSystem == "strict" && r.CPUAccounting && r.NoNewPrivileges && r.PrivateNetwork && r.PrivateTmp && r.ProtectHome && r.CapabilityBoundingSet == 0 && r.AmbientCapabilities == 0 && r.RestrictAddressFamiliesAllow && same(r.ReadOnlyPaths, s.ReadOnlyPaths) && same(r.BindReadOnlyPaths, s.BindReadOnlyPaths) && same(r.ReadWritePaths, s.ReadWritePaths) && same(r.RestrictAddressFamilies, s.RestrictAddressFamilies)
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
