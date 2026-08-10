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
	"strconv"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/assets"
)

const (
	OutcomeSuccess         ErrorCode = "success"
	ProtocolVersion                  = 2
	MaxFrameBytes                    = 8 << 20
	SourceCeiling                    = 32 << 20
	ExpandedCeiling                  = 256 << 20
	AssetCountCeiling                = 128
	AssetBytesCeiling                = 64 << 20
	DiagnosticBytesCeiling           = 64 << 10
	MemoryCeiling                    = 512 << 20
	TasksCeiling                     = 32
	// This caps aggregate cgroup CPU at 18 seconds during RuntimeCeiling.
	CPUQuotaPercent = 60
	CPUPeriodUSec   = 1_000_000
	RuntimeCeiling  = 30 * time.Second
	CPUCeiling      = 20 * time.Second
	usageTimeout    = 100 * time.Millisecond
	runtimeTarget   = "/run/crux-anydoc/runtime"
	probeTarget     = "/run/crux-anydoc/probe"
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
	ErrInvalidResult          ErrorCode = "invalid-result"
	ErrEncrypted              ErrorCode = "encrypted"
	ErrExpandedTooLarge       ErrorCode = "expanded-too-large"
	ErrUnsupportedFormat      ErrorCode = "unsupported-format"
)

type Format string

const (
	FormatDOC  Format = "doc"
	FormatDOCM Format = "docm"
	FormatDOCX Format = "docx"
	FormatRTF  Format = "rtf"
	FormatODT  Format = "odt"
	FormatEPUB Format = "epub"
	FormatPPT  Format = "ppt"
	FormatPPS  Format = "pps"
	FormatPOT  Format = "pot"
	FormatPPTX Format = "pptx"
	FormatPPTM Format = "pptm"
	FormatPPSX Format = "ppsx"
	FormatPPSM Format = "ppsm"
	FormatODP  Format = "odp"
	FormatXLS  Format = "xls"
	FormatXLSB Format = "xlsb"
	FormatXLSX Format = "xlsx"
	FormatXLSM Format = "xlsm"
	FormatODS  Format = "ods"
	FormatCSV  Format = "csv"
	FormatPDF  Format = "pdf"
)

type SupervisorError struct {
	Code  ErrorCode
	cause error
}

func (e *SupervisorError) Error() string           { return string(e.Code) }
func closed(code ErrorCode) error                  { return &SupervisorError{Code: code} }
func closedWith(code ErrorCode, cause error) error { return &SupervisorError{Code: code, cause: cause} }
func (e *SupervisorError) Unwrap() error           { return e.cause }

type ResultValidationError struct {
	Stage      string
	ReasonCode string
}

func (e *ResultValidationError) Error() string {
	return "result-validation " + e.Stage + ":" + e.ReasonCode
}

func resultValidation(stage, reason string) error {
	if !validResultValidationStage(stage) {
		stage = "unknown"
	}
	if !validResultValidationReason(reason) {
		reason = "unknown"
	}
	return &ResultValidationError{Stage: stage, ReasonCode: reason}
}

func validResultValidationStage(stage string) bool {
	switch stage {
	case "decode/frame-json", "request-binding", "payload/validation", "accounting-refresh", "ack-write":
		return true
	}
	return false
}

func validResultValidationReason(reason string) bool {
	switch reason {
	case "mismatch", "invalid-frame", "invalid-result", "io", "unavailable":
		return true
	}
	return false
}

// validContainmentStage is the single allowlist for ContainmentError stages
// (runtime + cleanup diagnosis). Keep in sync with every stage site.
func validContainmentStage(stage string) bool {
	switch stage {
	case "preflight", "transient-unit-name", "authorization-socket", "authorization-socket-chmod", "result-socket", "result-socket-chmod", "start-transient-unit", "close-stdin", "wait-active", "authorize-accept", "authorize-peer-credentials", "authorize-report", "authorize-peer-identity", "authorize-encode", "containment-cleanup":
		return true
	}
	return false
}

// validContainmentReason is the single allowlist for ContainmentError reasons,
// including peer-mismatch and Finish cleanup diagnoses.
func validContainmentReason(reason string) bool {
	switch reason {
	case "unknown", "dbus-invalid-args", "dbus-access-denied", "dbus-other", "deadline", "io-or-systemd", "peer-mismatch", "accounting-evidence", "stop-unit", "wait-inactive", "terminal-status", "termination-evidence", "used-cached-accounting", "unit-cleanup", "staged-cleanup":
		return true
	}
	return false
}

var errCPUAccounting = errors.New("cpu accounting unavailable")

type Request struct {
	Version       int       `json:"version"`
	Nonce         string    `json:"nonce"`
	RequestDigest string    `json:"requestDigest"`
	Format        Format    `json:"format"`
	SourceSHA256  string    `json:"sourceSha256"`
	SourceBytes   int64     `json:"sourceBytes"`
	Limits        JobLimits `json:"limits"`
}
type JobLimits struct {
	SourceBytes      int64 `json:"sourceBytes"`
	ResultBytes      int64 `json:"resultBytes"`
	ExpandedBytes    int64 `json:"expandedBytes"`
	AssetCount       int64 `json:"assetCount"`
	AssetBytes       int64 `json:"assetBytes"`
	DiagnosticBytes  int64 `json:"diagnosticBytes"`
	MemoryBytes      int64 `json:"memoryBytes"`
	CPUMilliseconds  int64 `json:"cpuMilliseconds"`
	WallMilliseconds int64 `json:"wallMilliseconds"`
	PIDs             int64 `json:"pids"`
}
type Result struct {
	Request
	OK          bool              `json:"ok"`
	FailureKind FailureKind       `json:"failureKind,omitempty"`
	Error       ErrorCode         `json:"error,omitempty"`
	Payload     []byte            `json:"payload,omitempty"`
	Accounting  *ResultAccounting `json:"accounting,omitempty"`
}

type FailureKind string

const (
	FailureParser         FailureKind = "parser"
	FailureInfrastructure FailureKind = "infrastructure"
)

type ResultAccounting struct {
	SourceBytes     int64 `json:"sourceBytes"`
	RawBytes        int64 `json:"rawBytes"`
	ExpandedBytes   int64 `json:"expandedBytes"`
	AssetCount      int64 `json:"assetCount"`
	AssetBytes      int64 `json:"assetBytes"`
	DiagnosticCount int64 `json:"diagnosticCount"`
	DiagnosticBytes int64 `json:"diagnosticBytes"`
}

func validRequest(v Request) bool {
	return v.Version == ProtocolVersion && len(v.Nonce) == 32 && len(v.RequestDigest) == 64 && len(v.SourceSHA256) == 64 && hexOK(v.Nonce) && hexOK(v.RequestDigest) && hexOK(v.SourceSHA256) && validFormat(v.Format) && v.SourceBytes >= 0 && v.Limits.SourceBytes >= v.SourceBytes && v.Limits.SourceBytes <= SourceCeiling && v.Limits.ResultBytes > 0 && v.Limits.ResultBytes <= MaxFrameBytes && v.Limits.ExpandedBytes > 0 && v.Limits.ExpandedBytes <= ExpandedCeiling && v.Limits.AssetCount > 0 && v.Limits.AssetCount <= AssetCountCeiling && v.Limits.AssetBytes > 0 && v.Limits.AssetBytes <= AssetBytesCeiling && v.Limits.DiagnosticBytes > 0 && v.Limits.DiagnosticBytes <= DiagnosticBytesCeiling && v.Limits.MemoryBytes > 0 && v.Limits.MemoryBytes <= MemoryCeiling && v.Limits.CPUMilliseconds > 0 && v.Limits.CPUMilliseconds <= CPUCeiling.Milliseconds() && v.Limits.WallMilliseconds > 0 && v.Limits.WallMilliseconds <= RuntimeCeiling.Milliseconds() && v.Limits.PIDs > 0 && v.Limits.PIDs <= TasksCeiling && v.RequestDigest == requestDigest(v.Version, v.Nonce, v.Format, v.SourceSHA256, v.SourceBytes, v.Limits)
}

// requestDigest is SHA-256 over this language-independent encoding:
// "crux-anydoc-job-digest-v2\\x00", u32be(version), u32be(len(nonce)), nonce,
// u32be(len(format)), format, u32be(len(sourceSha256)), sourceSha256,
// u64be(sourceBytes), followed by every JobLimits field in declaration order.
func requestDigest(version int, nonce string, format Format, sourceSHA256 string, sourceBytes int64, limits JobLimits) string {
	h := sha256.New()
	_, _ = h.Write([]byte("crux-anydoc-job-digest-v2\x00"))
	var word [8]byte
	binary.BigEndian.PutUint32(word[:4], uint32(version))
	_, _ = h.Write(word[:4])
	for _, field := range []string{nonce, string(format), sourceSHA256} {
		binary.BigEndian.PutUint32(word[:4], uint32(len(field)))
		_, _ = h.Write(word[:4])
		_, _ = h.Write([]byte(field))
	}
	for _, value := range []int64{sourceBytes, limits.SourceBytes, limits.ResultBytes, limits.ExpandedBytes, limits.AssetCount, limits.AssetBytes, limits.DiagnosticBytes, limits.MemoryBytes, limits.CPUMilliseconds, limits.WallMilliseconds, limits.PIDs} {
		binary.BigEndian.PutUint64(word[:], uint64(value))
		_, _ = h.Write(word[:])
	}
	return hex.EncodeToString(h.Sum(nil))
}
func validFormat(format Format) bool {
	switch format {
	case FormatDOC, FormatDOCM, FormatDOCX, FormatRTF, FormatODT, FormatEPUB, FormatPPT, FormatPPS, FormatPOT, FormatPPTX, FormatPPTM, FormatPPSX, FormatPPSM, FormatODP, FormatXLS, FormatXLSB, FormatXLSX, FormatXLSM, FormatODS, FormatCSV, FormatPDF:
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
		if v.FailureKind != "" || v.Error != "" || len(v.Payload) == 0 || int64(len(v.Payload)) > v.Limits.ResultBytes || v.Accounting == nil {
			return false
		}
		accounting, err := recomputePayloadAccounting(v.Request, v.Payload)
		return err == nil && accounting == *v.Accounting
	}
	return v.Error != "" && validFailure(v.FailureKind, v.Error) && len(v.Payload) == 0 && v.Accounting == nil
}
func validFailure(kind FailureKind, code ErrorCode) bool {
	if kind == FailureParser {
		switch code {
		case ErrInvalidResult, ErrEncrypted, ErrExpandedTooLarge, ErrUnsupportedFormat:
			return true
		}
	}
	if kind == FailureInfrastructure {
		return knownInfrastructure(code)
	}
	return false
}

func knownInfrastructure(c ErrorCode) bool {
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

func jobLimits(l Limits) JobLimits {
	l = l.Clamp()
	cpuMilliseconds := l.RuntimeMax.Milliseconds() * int64(l.CPUQuotaPercent) / 100
	if cpuMilliseconds > CPUCeiling.Milliseconds() {
		cpuMilliseconds = CPUCeiling.Milliseconds()
	}

	return JobLimits{
		SourceBytes:      SourceCeiling,
		ResultBytes:      MaxFrameBytes,
		ExpandedBytes:    ExpandedCeiling,
		AssetCount:       AssetCountCeiling,
		AssetBytes:       AssetBytesCeiling,
		DiagnosticBytes:  DiagnosticBytesCeiling,
		MemoryBytes:      l.MemoryMax,
		CPUMilliseconds:  cpuMilliseconds,
		WallMilliseconds: l.RuntimeMax.Milliseconds(),
		PIDs:             int64(l.TasksMax),
	}
}

type ServiceSpec struct {
	Command, Environment, ReadOnlyPaths, InaccessiblePaths, BindReadOnlyPaths, ReadWritePaths, RestrictAddressFamilies []string
	MemoryMax, MemorySwapMax                                                                                           int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec                                                                      int
	RuntimeMax                                                                                                         time.Duration
	KillMode, ProtectSystem                                                                                            string
	CPUAccounting, NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome                                            bool
	NodeSHA256                                                                                                         string
	Node                                                                                                               assets.AttestedNode
	runtimeTreeDigest                                                                                                  string
	probe                                                                                                              *containmentProbe
}

// containmentProbe is an unexported, process-local seal for the host integration
// executable. It cannot be constructed through the public ingestion or backend
// APIs and is never present in production service specifications.
type containmentProbe struct {
	hostExecutable string
	executableSHA  string
	action         string
	resultPath     string
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
	return ServiceSpec{Command: []string{nodePath, runner}, NodeSHA256: nodeSHA256, Node: node, runtimeTreeDigest: digest, Environment: []string{"LANG=C", "PATH=/usr/bin:/bin"}, InaccessiblePaths: []string{"/opt", "/srv", "/var/lib"}, BindReadOnlyPaths: []string{runtime + ":" + runtimeTarget, hostSource + ":" + stagedSourceTarget}, ReadWritePaths: []string{tmp}, RestrictAddressFamilies: []string{"AF_UNIX"}, MemoryMax: l.MemoryMax, MemorySwapMax: 0, TasksMax: l.TasksMax, CPUQuotaPercent: l.CPUQuotaPercent, CPUQuotaPeriodUSec: CPUPeriodUSec, RuntimeMax: l.RuntimeMax, KillMode: "control-group", ProtectSystem: "strict", CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true}, nil
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
	ControlGroup                                                              string
	ControlGroupMembers                                                       []int
	MemoryMax, MemorySwapMax                                                  int64
	TasksMax, CPUQuotaPercent, CPUQuotaPeriodUSec                             int
	RuntimeMax                                                                time.Duration
	KillMode, ProtectSystem                                                   string
	CPUAccounting, NoNewPrivileges, PrivateNetwork, PrivateTmp, ProtectHome   bool
	ReadOnlyPaths, BindReadOnlyPaths, ReadWritePaths, RestrictAddressFamilies []string
	InaccessiblePaths                                                         []string
	CapabilityBoundingSet, AmbientCapabilities                                uint64
	RestrictAddressFamiliesAllow                                              bool
	DynamicUser                                                               bool
	UID                                                                       uint64
	PrivateUsers                                                              bool
	ProtectProc, ProcSubset                                                   string
	ServiceResult                                                             string
	ExecMainStatus                                                            int
	Populated                                                                 bool
	MemoryCurrent                                                             int64
	MemoryPeak                                                                int64
	MemoryEvents                                                              map[string]int64
	CPUStats, PIDsEvents                                                      map[string]int64
	RuntimeTreeDigest                                                         string
}

// TerminationEvidence is gathered after the unit is inactive and before it is
// unloaded. It is intentionally independent from the pre-stop snapshot.
type TerminationEvidence struct {
	ControlGroup string
	Empty        bool
	Absent       bool
}
type TerminalStatus struct {
	MainPID        int
	State          string
	ServiceResult  string
	ExecMainStatus int
}

type TerminalReport struct {
	PreStop     SandboxReport
	Termination TerminationEvidence
	CPU         time.Duration
	Wall        time.Duration
	Outcome     ErrorCode
	Cleaned     bool
}
type Unit interface {
	Report(context.Context) (SandboxReport, error)
	CPUUsage(context.Context) (time.Duration, error)
	Stop(context.Context) error
	WaitInactive(context.Context) error
	TerminalStatus(context.Context) (TerminalStatus, error)
	TerminationEvidence(context.Context, string) (TerminationEvidence, error)
	Cleanup(context.Context) error
}
type verifiedAccountingSnapshot interface {
	MarkSnapshotVerified()
	LastVerifiedSnapshot() (SandboxReport, time.Duration, bool)
}
type activeAccountingCollector interface {
	RefreshAccounting(context.Context) (time.Duration, error)
}
type accountingCaptureFailure uint8

const (
	accountingCaptureOK accountingCaptureFailure = iota
	accountingCaptureExactCgroupAbsent
	accountingCaptureInvalid
)

type terminalAccountingCapture interface {
	CaptureTerminalAccounting(context.Context) (SandboxReport, time.Duration, accountingCaptureFailure, error)
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
type attestedProbeVerifier interface {
	VerifyAttestedProbe(context.Context, *containmentProbe) error
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
	format        Format
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

func (s *Supervisor) Start(ctx context.Context, input []byte, format Format, launch LaunchDependency, tmp string, l Limits) (*Run, error) {
	if !admittedFormat(format) {
		return nil, closed(ErrInvalidRequest)
	}
	return s.start(ctx, input, format, launch, tmp, l)
}

// startEvaluation is reachable only by same-package evidence tests. Production
// callers can use only Start, which rejects every format until admission.
func (s *Supervisor) startEvaluation(ctx context.Context, input []byte, format Format, launch LaunchDependency, tmp string, l Limits) (*Run, error) {
	return s.start(ctx, input, format, launch, tmp, l)
}

func (s *Supervisor) start(ctx context.Context, input []byte, format Format, launch LaunchDependency, tmp string, l Limits) (*Run, error) {
	if s == nil || s.backend == nil || s.stager == nil {
		return nil, closed(ErrContainmentUnavailable)
	}
	if !validFormat(format) {
		return nil, closed(ErrInvalidRequest)
	}
	l = l.Clamp()
	limits := jobLimits(l)
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
		return nil, closedWith(ErrContainmentUnavailable, e)
	}
	if adjusted, ok := unit.(verifiedServiceSpec); ok {
		spec = adjusted.VerifiedServiceSpec(spec)
	}
	if !verify(ctx, unit, spec) {
		write.Close()
		_ = staged.Cleanup()
		_, _, _, _ = cleanup(unit)
		return nil, closed(ErrContainmentUnavailable)
	}
	if preparer, ok := unit.(authorizationPreparer); ok {
		if preparer.PrepareAuthorization(ctx) != nil {
			write.Close()
			_ = staged.Cleanup()
			_, _, _, _ = cleanup(unit)
			return nil, closed(ErrContainmentUnavailable)
		}
	}
	// After full unit/cgroup/runtime verification and DynamicUser preparation,
	// hand the exact staged source inode to the verified worker UID at 0400.
	if e = grantVerifiedSourceAccess(ctx, unit, staged); e != nil {
		write.Close()
		_ = staged.Cleanup()
		_, _, _, _ = cleanup(unit)
		return nil, closedWith(ErrContainmentUnavailable, e)
	}
	var n [16]byte
	if _, e = rand.Read(n[:]); e != nil {
		write.Close()
		_ = staged.Cleanup()
		_, _, _, _ = cleanup(unit)
		return nil, closed(ErrContainmentUnavailable)
	}
	d := sha256.Sum256(input)
	nonce := hex.EncodeToString(n[:])
	sourceSHA := hex.EncodeToString(d[:])
	r := &Run{unit: unit, write: write, nonce: nonce, digest: requestDigest(ProtocolVersion, nonce, format, sourceSHA, int64(len(input)), limits), sourceSHA: sourceSHA, sourceBytes: int64(len(input)), format: format, limits: limits, staged: staged, stop: make(chan struct{}), finished: make(chan struct{}), started: s.now()}
	go r.monitor()
	return r, nil
}

func admissionCandidateFormat(format Format) bool {
	switch format {
	case FormatDOC, FormatDOCM, FormatDOCX, FormatRTF, FormatODT, FormatEPUB, FormatPPT, FormatPPS, FormatPOT, FormatPPTX, FormatPPTM, FormatPPSX, FormatPPSM, FormatODP, FormatXLS, FormatXLSB, FormatODS:
		return true
	}
	return false
}

func admittedFormat(Format) bool {
	// The Phase 2 ADR currently admits no Anydoc primary.
	return false
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
	v := Request{Version: ProtocolVersion, Nonce: r.nonce, RequestDigest: r.digest, SourceSHA256: r.sourceSHA, Format: r.format, SourceBytes: r.sourceBytes, Limits: r.limits}
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
		if e != nil {
			return closedWith(ErrContainmentUnavailable, e)
		}
		return closedWith(ErrContainmentUnavailable, containment("authorize-encode", closeErr))
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
	expected := Request{Version: ProtocolVersion, Nonce: r.nonce, RequestDigest: r.digest, Format: r.format, SourceSHA256: r.sourceSHA, SourceBytes: r.sourceBytes, Limits: r.limits}
	result, err := receiver.ReceiveResult(ctx, expected)
	if err != nil {
		var sup *SupervisorError
		if errors.As(err, &sup) {
			return Result{}, err
		}
		if ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
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
		report, cpu, termination, cleanupReason := cleanup(r.unit)
		unitCleaned := cleanupReason == ""
		if !unitCleaned {
			result = chainContainment(result, "containment-cleanup", cleanupReason)
		}
		stagedCleaned := r.staged != nil && r.staged.Cleanup() == nil
		if !stagedCleaned {
			result = chainContainment(result, "containment-cleanup", "staged-cleanup")
		}
		r.mu.Lock()
		r.terminal = TerminalReport{PreStop: cloneSandboxReport(report), Termination: termination, CPU: cpu, Wall: time.Since(r.started), Outcome: errorCode(result), Cleaned: unitCleaned && stagedCleaned}
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
	return TerminalReport{PreStop: cloneSandboxReport(r.terminal.PreStop), Termination: r.terminal.Termination, CPU: r.terminal.CPU, Wall: r.terminal.Wall, Outcome: r.terminal.Outcome, Cleaned: r.terminal.Cleaned}
}
func cloneSandboxReport(in SandboxReport) SandboxReport {
	out := in
	out.ControlGroupMembers = append([]int(nil), in.ControlGroupMembers...)
	out.ReadOnlyPaths = append([]string(nil), in.ReadOnlyPaths...)
	out.InaccessiblePaths = append([]string(nil), in.InaccessiblePaths...)
	out.BindReadOnlyPaths = append([]string(nil), in.BindReadOnlyPaths...)
	out.ReadWritePaths = append([]string(nil), in.ReadWritePaths...)
	out.RestrictAddressFamilies = append([]string(nil), in.RestrictAddressFamilies...)
	if in.MemoryEvents != nil {
		out.MemoryEvents = make(map[string]int64, len(in.MemoryEvents))
		for k, v := range in.MemoryEvents {
			out.MemoryEvents[k] = v
		}
	}
	if in.CPUStats != nil {
		out.CPUStats = make(map[string]int64, len(in.CPUStats))
		for k, v := range in.CPUStats {
			out.CPUStats[k] = v
		}
	}
	if in.PIDsEvents != nil {
		out.PIDsEvents = make(map[string]int64, len(in.PIDsEvents))
		for k, v := range in.PIDsEvents {
			out.PIDsEvents[k] = v
		}
	}
	return out
}
func errorCode(err error) ErrorCode {
	var e *SupervisorError
	if errors.As(err, &e) {
		return e.Code
	}
	return OutcomeSuccess
}
func safeExecutionFailure(err error, terminal TerminalReport) string {
	var validation *ResultValidationError
	hasValidation := errors.As(err, &validation)
	var containment *ContainmentError
	hasContainment := errors.As(err, &containment)

	var errorStr string
	code := errorCode(err)
	if hasValidation {
		code = ErrInvalidResult
	}
	switch code {
	case ErrTimeout, ErrWorkerCrash, ErrContainmentUnavailable, ErrAborted, ErrInvalidResult:
		errorStr = string(code)
	default:
		errorStr = "unknown"
	}

	outcome := string(terminal.Outcome)
	switch terminal.Outcome {
	case ErrTimeout, ErrWorkerCrash, ErrContainmentUnavailable, ErrAborted, ErrInvalidResult:
	default:
		outcome = "unknown"
	}

	serviceResult := terminal.PreStop.ServiceResult
	switch serviceResult {
	case "success", "timeout", "oom-kill", "signal", "exit-code", "core-dump", "resources":
	default:
		serviceResult = "unknown"
	}

	oomKilled := terminal.PreStop.MemoryEvents["oom_kill"] > 0
	pidsLimited := terminal.PreStop.PIDsEvents["max"] > 0

	var stage, reason string
	if hasValidation {
		stage = validation.Stage
		if !validResultValidationStage(stage) {
			stage = "unknown"
		}
		reason = validation.ReasonCode
		if !validResultValidationReason(reason) {
			reason = "unknown"
		}
	} else if hasContainment {
		stage = containment.Stage
		if !validContainmentStage(stage) {
			stage = "unknown"
		}
		reason = containment.ReasonCode
		if !validContainmentReason(reason) {
			reason = "unknown"
		}
	} else {
		stage = safeRunnerStage(terminal.PreStop.ExecMainStatus)
		reason = ""
	}

	out := "error=" + errorStr + " outcome=" + outcome + " service=" + serviceResult + " stage=" + stage
	if hasValidation || hasContainment {
		out += " reason=" + reason
	}
	out += " oom-killed=" + strconv.FormatBool(oomKilled) + " pids-limited=" + strconv.FormatBool(pidsLimited)
	return out
}
func safeRunnerStage(status int) string {
	switch status {
	case 0:
		return "success"
	case 70:
		return "authorization"
	case 71:
		return "request-validation"
	case 72:
		return "source-validation"
	case 73:
		return "native-load"
	case 74:
		return "conversion-projection"
	case 75:
		return "result-write"
	case 76:
		return "acknowledgement"
	default:
		return "unknown"
	}
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
	var validation *ResultValidationError
	if errors.As(out, &validation) {
		return closedWith(ErrInvalidResult, validation)
	}
	if out != nil {
		return closed(ErrWorkerCrash)
	}
	return nil
}
// chainContainment wraps a prior result, or synthesizes a typed ContainmentError
// when cleanup fails after a successful service. Pure cleanup never uses
// ResultValidationError so safeExecutionFailure cannot mis-promote it.
func chainContainment(result error, stage, reason string) error {
	if result != nil {
		return closedWith(ErrContainmentUnavailable, result)
	}
	if !validContainmentStage(stage) {
		stage = "unknown"
	}
	if !validContainmentReason(reason) {
		reason = "unknown"
	}
	return closedWith(ErrContainmentUnavailable, &ContainmentError{Stage: stage, ReasonCode: reason})
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
			var u time.Duration
			var reportErr, cpuErr error
			if collector, ok := r.unit.(activeAccountingCollector); ok {
				u, reportErr = collector.RefreshAccounting(ctx)
				cpuErr = reportErr
			} else {
				_, reportErr = r.unit.Report(ctx)
				u, cpuErr = r.unit.CPUUsage(ctx)
			}
			if reportErr != nil || cpuErr != nil {
				status, statusErr := r.unit.TerminalStatus(ctx)
				cancel()
				cached := false
				if snapshots, ok := r.unit.(verifiedAccountingSnapshot); ok {
					_, _, cached = snapshots.LastVerifiedSnapshot()
				}
				if cached && statusErr == nil && status.MainPID == 0 && (status.State == "inactive" || status.State == "failed") {
					return
				}
				r.Finish(context.Background(), errCPUAccounting)
				return
			}
			cancel()
			if u >= CPUCeiling {
				r.Finish(context.Background(), context.DeadlineExceeded)
				return
			}
		}
	}
}
func cleanup(unit Unit) (SandboxReport, time.Duration, TerminationEvidence, string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if unit == nil {
		return SandboxReport{}, 0, TerminationEvidence{}, "unit-cleanup"
	}
	var reason string
	usedCachedAccounting := false
	captureFailure := accountingCaptureInvalid
	var report SandboxReport
	var cpu time.Duration
	var captureErr error
	if capture, supported := unit.(terminalAccountingCapture); supported {
		report, cpu, captureFailure, captureErr = capture.CaptureTerminalAccounting(ctx)
	} else {
		var reportErr, cpuErr error
		report, reportErr = unit.Report(ctx)
		cpu, cpuErr = unit.CPUUsage(ctx)
		if reportErr != nil {
			captureErr = reportErr
		} else {
			captureErr = cpuErr
		}
		if captureErr == nil {
			captureFailure = accountingCaptureOK
		}
	}
	if captureErr != nil {
		// Snapshot fallback is only valid when the exact original cgroup
		// path is gone (ENOENT). Malformed-but-present data and any other
		// capture error must fail closed as accounting-evidence.
		snapshots, hasSnapshots := unit.(verifiedAccountingSnapshot)
		cachedReport, cachedCPU, cached := SandboxReport{}, time.Duration(0), false
		if hasSnapshots {
			cachedReport, cachedCPU, cached = snapshots.LastVerifiedSnapshot()
		}
		if cached && captureFailure == accountingCaptureExactCgroupAbsent {
			report, cpu = cachedReport, cachedCPU
			usedCachedAccounting = true
		} else if reason == "" {
			reason = "accounting-evidence"
		}
	}
	if unit.Stop(ctx) != nil {
		if reason == "" {
			reason = "stop-unit"
		}
	}
	if unit.WaitInactive(ctx) != nil {
		if reason == "" {
			reason = "wait-inactive"
		}
	}
	status, statusErr := unit.TerminalStatus(ctx)
	if statusErr != nil || status.MainPID != 0 || (status.State != "inactive" && status.State != "failed") {
		if reason == "" {
			reason = "terminal-status"
		}
	} else {
		report.MainPID = status.MainPID
		report.ServiceResult = status.ServiceResult
		report.ExecMainStatus = status.ExecMainStatus
	}
	termination, terminationErr := unit.TerminationEvidence(ctx, report.ControlGroup)
	if terminationErr != nil || termination.ControlGroup != report.ControlGroup || (!termination.Empty && !termination.Absent) || (termination.Empty && termination.Absent) {
		if reason == "" {
			reason = "termination-evidence"
		}
	}
	if usedCachedAccounting && !termination.Absent {
		if reason == "" {
			reason = "used-cached-accounting"
		}
	}
	if unit.Cleanup(ctx) != nil {
		if reason == "" {
			reason = "unit-cleanup"
		}
	}
	return report, cpu, termination, reason
}
func verify(ctx context.Context, u Unit, s ServiceSpec) bool {
	if u == nil {
		return false
	}
	r, e := u.Report(ctx)
	if e != nil {
		return false
	}
	if s.probe != nil {
		verifier, ok := u.(attestedProbeVerifier)
		if !ok || verifier.VerifyAttestedProbe(ctx, s.probe) != nil {
			return false
		}
	} else if verifier, ok := u.(attestedNodeVerifier); ok {
		if err := verifier.VerifyAttestedNode(ctx, s.Node); err != nil {
			return false
		}
	}
	valid := r.MainPID > 0 && r.RuntimeTreeDigest == s.runtimeTreeDigest && r.UID > 0 && r.DynamicUser && r.PrivateUsers && r.ProtectProc == "invisible" && r.ProcSubset == "pid" && contains(r.ControlGroupMembers, r.MainPID) && r.MemoryMax == s.MemoryMax && r.MemorySwapMax == 0 && r.TasksMax == s.TasksMax && r.CPUQuotaPercent == s.CPUQuotaPercent && r.CPUQuotaPeriodUSec == s.CPUQuotaPeriodUSec && r.RuntimeMax == s.RuntimeMax && r.KillMode == s.KillMode && r.ProtectSystem == "strict" && r.CPUAccounting && r.NoNewPrivileges && r.PrivateNetwork && r.PrivateTmp && r.ProtectHome && r.CapabilityBoundingSet == 0 && r.AmbientCapabilities == 0 && r.RestrictAddressFamiliesAllow && same(r.ReadOnlyPaths, s.ReadOnlyPaths) && same(r.InaccessiblePaths, s.InaccessiblePaths) && same(r.BindReadOnlyPaths, s.BindReadOnlyPaths) && same(r.ReadWritePaths, s.ReadWritePaths) && same(r.RestrictAddressFamilies, s.RestrictAddressFamilies)
	if valid {
		if snapshots, ok := u.(verifiedAccountingSnapshot); ok {
			snapshots.MarkSnapshotVerified()
		}
	}
	return valid
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
