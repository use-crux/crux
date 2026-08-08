//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
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
	r, e := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if e != nil {
		t.Fatal(e)
	}
	d := sha256.Sum256([]byte("x"))
	limits := testJobLimits()
	v := Request{Version: ProtocolVersion, Nonce: r.nonce, RequestDigest: requestDigest(ProtocolVersion, r.nonce, FormatDOCX, hex.EncodeToString(d[:]), 1, limits), SourceSHA256: hex.EncodeToString(d[:]), Format: FormatDOCX, SourceBytes: 1, Limits: limits}
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
	request := validTestRequest(FormatDOCX)
	payload := validAdmissionPayloadWithAsset(request, "AQID")
	accounting, err := recomputePayloadAccounting(request, payload)
	if err != nil {
		t.Fatal(err)
	}
	nativeStart := bytes.Index(payload, []byte(`"native":`)) + len(`"native":`)
	coreMarker := bytes.Index(payload, []byte(`,"core":`))
	coreStart := coreMarker + len(`,"core":`)
	assetsMarker := bytes.LastIndex(payload, []byte(`,"assets":[{"id":1`))
	exactRawBytes := int64(coreMarker - nativeStart + assetsMarker - coreStart + len(`{"native":,"core":}`))
	if accounting.RawBytes != exactRawBytes {
		t.Fatalf("raw accounting = %d, want exact wire bytes %d", accounting.RawBytes, exactRawBytes)
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
	r, _ := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
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
	_, e = supervisor.startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
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
	r, e := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
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
	err = EncodeResult(bytes.NewBuffer(nil), Result{Request: Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), RequestDigest: strings.Repeat("b", 64), SourceSHA256: strings.Repeat("c", 64), Format: FormatDOCX, Limits: testJobLimits()}, OK: true, Error: ErrTimeout})
	assert(t, err, ErrInvalidRequest)
}

func TestSuccessfulResultRecomputesBoundedWireAccounting(t *testing.T) {
	request := validTestRequest(FormatDOCX)
	payload := validAdmissionPayloadWithAsset(request, "AQID")
	accounting, err := recomputePayloadAccounting(request, payload)
	if err != nil {
		t.Fatal(err)
	}
	valid := Result{Request: request, OK: true, Payload: payload, Accounting: &accounting}
	if err := EncodeResult(bytes.NewBuffer(nil), valid); err != nil {
		t.Fatalf("valid payload rejected: %v", err)
	}
	tampered := accounting
	tampered.AssetBytes++
	valid.Accounting = &tampered
	if err := EncodeResult(bytes.NewBuffer(nil), valid); err == nil {
		t.Fatal("worker accounting was trusted")
	}
	valid.Accounting = &accounting
	valid.Payload = []byte(`{"kind":"anydoc-admission-v2","native":{},"core":{},"assets":[],"diagnostics":[]}`)
	if err := EncodeResult(bytes.NewBuffer(nil), valid); err == nil {
		t.Fatal("malformed wire payload accepted")
	}
}

func TestAdmissionResultRejectsUnknownProjectionShapesAndAssetMutation(t *testing.T) {
	request := validTestRequest(FormatDOCX)
	unknownNative := bytes.Replace(validAdmissionPayload(request), []byte(`"facts":`), []byte(`"unknown":true,"facts":`), 1)
	if _, err := recomputePayloadAccounting(request, unknownNative); err == nil {
		t.Fatal("unknown native fact envelope field accepted")
	}
	unknownCore := bytes.Replace(validAdmissionPayload(request), []byte(`"diagnostics":[]},"assets"`), []byte(`"diagnostics":[],"unknown":true},"assets"`), 1)
	if _, err := recomputePayloadAccounting(request, unknownCore); err == nil {
		t.Fatal("unknown Core projection field accepted")
	}
	assetMutation := validAdmissionPayloadWithAsset(request, "AQIE")
	if _, err := recomputePayloadAccounting(request, assetMutation); err == nil {
		t.Fatal("asset bytes independent of the Core digest accepted")
	}
}

func TestAdmissionResultStrictlyBindsNestedEvidence(t *testing.T) {
	request := validTestRequest(FormatDOCX)
	valid := validAdmissionPayloadWithBlock(request)
	if _, err := recomputePayloadAccounting(request, valid); err != nil {
		t.Fatalf("valid bound block rejected: %v", err)
	}
	mutations := map[string][]byte{
		"unknown nested fact": bytes.Replace(valid, []byte(`"kind":"heading"`), []byte(`"kind":"heading","unknown":true`), 1),
		"source hash":         bytes.Replace(valid, []byte(request.SourceSHA256), []byte(strings.Repeat("d", 64)), 1),
		"producer":            bytes.Replace(valid, []byte(`"version":"0.1.7"`), []byte(`"version":"0.1.6"`), 1),
		"coordinate":          bytes.Replace(valid, []byte(`"documentSha256":"`+request.SourceSHA256+`"`), []byte(`"documentSha256":"`+strings.Repeat("d", 64)+`"`), 2),
		"block fact path":     bytes.Replace(valid, []byte(`:document/block:1"`), []byte(`:document/block:2"`), 1),
	}
	for name, payload := range mutations {
		t.Run(name, func(t *testing.T) {
			if _, err := recomputePayloadAccounting(request, payload); err == nil {
				t.Fatal("mutated nested evidence accepted")
			}
		})
	}
}

func TestResultFailureKindsKeepParserOutcomesDistinct(t *testing.T) {
	request := validTestRequest(FormatDOCX)
	for _, result := range []Result{
		{Request: request, OK: false, FailureKind: FailureParser, Error: ErrEncrypted},
		{Request: request, OK: false, FailureKind: FailureInfrastructure, Error: ErrTimeout},
	} {
		if err := EncodeResult(bytes.NewBuffer(nil), result); err != nil {
			t.Fatalf("valid typed failure rejected: %v", err)
		}
	}
	for _, result := range []Result{
		{Request: request, OK: false, FailureKind: FailureParser, Error: ErrTimeout},
		{Request: request, OK: false, FailureKind: FailureInfrastructure, Error: ErrEncrypted},
		{Request: request, OK: false, Error: ErrEncrypted},
	} {
		if err := EncodeResult(bytes.NewBuffer(nil), result); err == nil {
			t.Fatalf("mismatched failure accepted: %#v", result)
		}
	}
}

func validTestRequest(format Format) Request {
	request := Request{Version: ProtocolVersion, Nonce: strings.Repeat("a", 32), SourceSHA256: strings.Repeat("c", 64), Format: format, Limits: testJobLimits()}
	request.RequestDigest = requestDigest(request.Version, request.Nonce, request.Format, request.SourceSHA256, request.SourceBytes, request.Limits)
	return request
}

func validWireResult(request Request) Result {
	payload := validAdmissionPayload(request)
	accounting, err := recomputePayloadAccounting(request, payload)
	if err != nil {
		panic(err)
	}
	return Result{Request: request, OK: true, Payload: payload, Accounting: &accounting}
}
func TestExecuteFinishesAfterResultFailure(t *testing.T) {
	b := &fakeBackend{}
	supervisor := newTestSupervisor(t, b)
	r, err := supervisor.startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
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

func TestSelectedFormatIsBoundThroughAuthorizationAndResult(t *testing.T) {
	b := &fakeBackend{receive: func(_ context.Context, request Request) (Result, error) {
		if request.Format != FormatODT {
			t.Fatalf("result expected format = %q", request.Format)
		}
		payload := validAdmissionPayload(request)
		accounting, err := recomputePayloadAccounting(request, payload)
		return Result{Request: request, OK: true, Payload: payload, Accounting: &accounting}, err
	}}
	run, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatODT, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if err := run.Authorize(); err != nil {
		t.Fatal(err)
	}
	request, err := DecodeRequest(b.read)
	if err != nil || request.Format != FormatODT {
		t.Fatalf("authorized format = %q, %v", request.Format, err)
	}
	if _, err := run.ReceiveResult(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func validAdmissionPayload(request Request) []byte {
	producer := `{"kind":"parser","name":"anydoc","version":"0.1.7","adapterVersion":"2-admission"}`
	coordinate := fmt.Sprintf(`{"kind":"document","documentSha256":%q}`, request.SourceSHA256)
	facts := fmt.Sprintf(`[{"kind":"ordered-text","text":[],"factPath":"document"},{"kind":"notes","text":[],"factPath":"document"},{"kind":"asset-count","count":0,"factPath":"document"},{"kind":"coordinate-kinds","kinds":["document"],"factPath":"document"},{"kind":"no-parser-downgrade","factPath":"document"},{"kind":"provenance","path":"document","coordinate":%s,"producer":%s,"factPath":"document"}]`, coordinate, producer)
	return []byte(fmt.Sprintf(`{"kind":"anydoc-admission-v2","native":{"kind":"anydoc-native-v2","source":{"documentSha256":%q,"format":%q},"observed":{"blockCount":0,"noteCount":0,"assets":[]},"facts":%s},"core":{"schemaVersion":2,"source":{"documentSha256":%q,"mediaType":%q,"format":%q},"producer":%s,"metadata":{"anydocRelationships":"{\"notes\":[],\"inlines\":[]}"},"blocks":[],"assets":[],"diagnostics":[]},"assets":[],"diagnostics":[]}`, request.SourceSHA256, request.Format, facts, request.SourceSHA256, formatMediaType(request.Format), request.Format, producer))
}

func validAdmissionPayloadWithAsset(request Request, data string) []byte {
	payload := string(validAdmissionPayload(request))
	payload = strings.Replace(payload, `"assets":[]},"facts"`, `"assets":[{"id":1,"mediaType":"image/png","originPart":"word/media/a.png","byteLength":3}]},"facts"`, 1)
	payload = strings.Replace(payload, `"asset-count","count":0`, `"asset-count","count":1`, 1)
	payload = strings.Replace(payload, `"kinds":["document"]`, `"kinds":["document","package-part"]`, 1)
	payload = strings.Replace(payload, `"facts":[`, `"facts":[{"kind":"provenance","path":"assets/1","coordinate":{"kind":"package-part","part":"word/media/a.png"},"producer":{"kind":"parser","name":"anydoc","version":"0.1.7","adapterVersion":"2-admission"},"factPath":"assets/1"},`, 1)
	projected := fmt.Sprintf(`{"id":"anydoc:%s:asset:1","mediaType":"image/png","sha256":"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81","byteLength":3,"coordinate":{"kind":"package-part","part":"word/media/a.png"},"producer":{"kind":"parser","name":"anydoc","version":"0.1.7","adapterVersion":"2-admission"}}`, request.SourceSHA256)
	payload = strings.Replace(payload, `"assets":[],"diagnostics":[]},"assets":[]`, `"assets":[`+projected+`],"diagnostics":[]},"assets":[{"id":1,"mediaType":"image/png","originPart":"word/media/a.png","data":"`+data+`"}]`, 1)
	return []byte(payload)
}

func validAdmissionPayloadWithBlock(request Request) []byte {
	payload := string(validAdmissionPayload(request))
	producer := `{"kind":"parser","name":"anydoc","version":"0.1.7","adapterVersion":"2-admission"}`
	coordinate := fmt.Sprintf(`{"kind":"document","documentSha256":%q}`, request.SourceSHA256)
	facts := fmt.Sprintf(`{"kind":"heading","level":1,"text":"Title","factPath":"blocks/1"},{"kind":"provenance","path":"blocks/1","coordinate":%s,"producer":%s,"factPath":"blocks/1"},`, coordinate, producer)
	payload = strings.Replace(payload, `"blockCount":0`, `"blockCount":1`, 1)
	payload = strings.Replace(payload, `"facts":[`, `"facts":[`+facts, 1)
	block := fmt.Sprintf(`{"id":"anydoc:%s:1:document/block:1","kind":"text","coordinate":%s,"headingPath":[],"producer":%s,"role":"heading","text":"Title","inlines":[{"kind":"text","text":"Title","coordinate":%s,"producer":%s}],"level":1}`, request.SourceSHA256, coordinate, producer, coordinate, producer)
	payload = strings.Replace(payload, `"blocks":[]`, `"blocks":[`+block+`]`, 1)
	return []byte(payload)
}

func TestExecuteMapsCallerCancellationToAbort(t *testing.T) {
	b := &fakeBackend{receive: func(ctx context.Context, _ Request) (Result, error) {
		<-ctx.Done()
		return Result{}, ctx.Err()
	}}
	r, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = r.Execute(ctx)
	assert(t, err, ErrAborted)
	if report := r.TerminalReport(); report.Outcome != ErrAborted || !report.Cleaned {
		t.Fatalf("cancellation terminal report = %#v", report)
	}
}
func TestCPUQuotaBoundsRuntimeBudgetAndUsageFailureFailsClosed(t *testing.T) {
	if time.Duration(CPUQuotaPercent)*RuntimeCeiling/100 >= CPUCeiling {
		t.Fatal("service quota can exceed CPU budget")
	}
	b := &fakeBackend{cpuErr: true}
	r, e := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if e != nil {
		t.Fatal(e)
	}
	time.Sleep(30 * time.Millisecond)
	assert(t, r.Finish(context.Background(), nil), ErrContainmentUnavailable)
}

func TestTerminalReportCopiesConcurrentAccounting(t *testing.T) {
	r := &Run{}
	done := make(chan struct{})
	go func() {
		for i := 0; i < 1_000; i++ {
			r.mu.Lock()
			r.terminal = TerminalReport{PreStop: SandboxReport{MemoryEvents: map[string]int64{"oom": int64(i)}}}
			r.mu.Unlock()
		}
		close(done)
	}()
	for i := 0; i < 1_000; i++ {
		report := r.TerminalReport()
		if report.PreStop.MemoryEvents != nil {
			report.PreStop.MemoryEvents["caller"] = 1
		}
	}
	<-done
}

func TestTerminalReportSeparatesPreStopSnapshotFromTerminationEvidence(t *testing.T) {
	backend := &fakeBackend{}
	run, err := newTestSupervisor(t, backend).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if err := run.Finish(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	report := run.TerminalReport()
	if !report.PreStop.Populated {
		t.Fatal("pre-stop report was replaced with termination state")
	}
	if report.Termination != (TerminationEvidence{ControlGroup: "/fake", Empty: true}) {
		t.Fatalf("termination evidence = %#v", report.Termination)
	}
	if !report.Cleaned {
		t.Fatal("cleanup rejected a populated pre-stop cgroup")
	}
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
	limits := JobLimits{SourceBytes: 1024, ResultBytes: 2048, ExpandedBytes: 4096, AssetCount: 8, AssetBytes: 3072, DiagnosticBytes: 512, MemoryBytes: 64 << 20, CPUMilliseconds: 900, WallMilliseconds: 1500, PIDs: 4}
	base := requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, limits)
	if base != "332d6b7ec71ed71c0ca4de37239ea3f8746d669feb80cbac7600e83f123d603f" {
		t.Fatalf("fixed digest = %s", base)
	}
	for _, changed := range []string{
		requestDigest(ProtocolVersion, strings.Repeat("c", 32), FormatDOCX, strings.Repeat("b", 64), 3, limits),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatODT, strings.Repeat("b", 64), 3, limits),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("c", 64), 3, limits),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 4, limits),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withSourceBytes(limits, 1025)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withResultBytes(limits, 2049)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withExpandedBytes(limits, 4097)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withAssetCount(limits, 9)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withAssetBytes(limits, 3073)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withDiagnosticBytes(limits, 513)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withMemoryBytes(limits, (64<<20)+1)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withCPUMilliseconds(limits, 901)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withWallMilliseconds(limits, 1501)),
		requestDigest(ProtocolVersion, strings.Repeat("a", 32), FormatDOCX, strings.Repeat("b", 64), 3, withPIDs(limits, 5)),
	} {
		if changed == base {
			t.Fatal("digest omitted a job field")
		}
	}
}

func TestClosedAnydocFormatsRejectUnknownValues(t *testing.T) {
	for _, format := range []Format{FormatDOC, FormatDOCM, FormatDOCX, FormatRTF, FormatODT, FormatEPUB, FormatPPT, FormatPPS, FormatPOT, FormatPPTX, FormatPPTM, FormatPPSX, FormatPPSM, FormatODP, FormatXLS, FormatXLSB, FormatXLSX, FormatXLSM, FormatODS, FormatCSV, FormatPDF} {
		if !validFormat(format) {
			t.Fatalf("parser capability rejected: %q", format)
		}
	}
	if validFormat(Format("unknown")) {
		t.Fatal("unknown parser format accepted")
	}
	for _, control := range []Format{FormatPDF, FormatCSV, FormatXLSX, FormatXLSM} {
		if admissionCandidateFormat(control) {
			t.Fatalf("incumbent control became an Anydoc admission candidate: %q", control)
		}
	}
	for _, candidate := range []Format{FormatDOC, FormatDOCM, FormatDOCX, FormatRTF, FormatODT, FormatEPUB, FormatPPT, FormatPPS, FormatPOT, FormatPPTX, FormatPPTM, FormatPPSX, FormatPPSM, FormatODP, FormatXLS, FormatXLSB, FormatODS} {
		if !admissionCandidateFormat(candidate) || admittedFormat(candidate) {
			t.Fatalf("candidate policy drifted before admission evidence: %q", candidate)
		}
	}
}

func TestAdmissionStartRejectsControlsAndUnadmittedCandidatesBeforeLaunch(t *testing.T) {
	for _, format := range []Format{FormatCSV, FormatXLSX, FormatPDF, FormatDOCX, FormatPPTX} {
		backend := &fakeBackend{}
		_, err := newTestSupervisor(t, backend).Start(context.Background(), []byte("x"), format, testLaunch(), "/run/tmp", Limits{})
		assert(t, err, ErrInvalidRequest)
		if backend.u != nil {
			t.Fatalf("admission rejection launched worker for %q", format)
		}
	}
}

func testJobLimits() JobLimits {
	return jobLimits(Limits{})
}

func withSourceBytes(l JobLimits, value int64) JobLimits      { l.SourceBytes = value; return l }
func withResultBytes(l JobLimits, value int64) JobLimits      { l.ResultBytes = value; return l }
func withExpandedBytes(l JobLimits, value int64) JobLimits    { l.ExpandedBytes = value; return l }
func withAssetCount(l JobLimits, value int64) JobLimits       { l.AssetCount = value; return l }
func withAssetBytes(l JobLimits, value int64) JobLimits       { l.AssetBytes = value; return l }
func withDiagnosticBytes(l JobLimits, value int64) JobLimits  { l.DiagnosticBytes = value; return l }
func withMemoryBytes(l JobLimits, value int64) JobLimits      { l.MemoryBytes = value; return l }
func withCPUMilliseconds(l JobLimits, value int64) JobLimits  { l.CPUMilliseconds = value; return l }
func withWallMilliseconds(l JobLimits, value int64) JobLimits { l.WallMilliseconds = value; return l }
func withPIDs(l JobLimits, value int64) JobLimits             { l.PIDs = value; return l }

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
	u       *fakeUnit
	read    *os.File
	bad     bool
	cpu     time.Duration
	cpuErr  bool
	receive func(context.Context, Request) (Result, error)
}

func (b *fakeBackend) Start(_ context.Context, s ServiceSpec, r *os.File) (Unit, error) {
	b.read = r
	rep := SandboxReport{MainPID: 42, ControlGroup: "/fake", RuntimeTreeDigest: s.runtimeTreeDigest, UID: 1000, DynamicUser: true, PrivateUsers: true, ProtectProc: "invisible", ProcSubset: "pid", ControlGroupMembers: []int{42}, MemoryMax: s.MemoryMax, MemorySwapMax: 0, TasksMax: s.TasksMax, CPUQuotaPercent: s.CPUQuotaPercent, CPUQuotaPeriodUSec: s.CPUQuotaPeriodUSec, RuntimeMax: s.RuntimeMax, KillMode: s.KillMode, ProtectSystem: s.ProtectSystem, CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true, CapabilityBoundingSet: 0, AmbientCapabilities: 0, ReadOnlyPaths: s.ReadOnlyPaths, InaccessiblePaths: s.InaccessiblePaths, BindReadOnlyPaths: s.BindReadOnlyPaths, ReadWritePaths: s.ReadWritePaths, RestrictAddressFamiliesAllow: true, RestrictAddressFamilies: s.RestrictAddressFamilies, Populated: true}
	if b.bad {
		rep.MemoryMax = 1
	}
	b.u = &fakeUnit{rep: rep, cpu: b.cpu, cpuErr: b.cpuErr, receive: b.receive}
	return b.u, nil
}

type fakeUnit struct {
	rep              SandboxReport
	cpu              time.Duration
	cpuErr           bool
	receive          func(context.Context, Request) (Result, error)
	stopped, cleaned bool
	mu               sync.Mutex
}

func (u *fakeUnit) Report(context.Context) (SandboxReport, error) { return u.rep, nil }
func (u *fakeUnit) ReceiveResult(ctx context.Context, request Request) (Result, error) {
	if u.receive != nil {
		return u.receive(ctx, request)
	}
	return Result{}, errors.New("worker failed")
}
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
func (u *fakeUnit) TerminalStatus(context.Context) (TerminalStatus, error) {
	return TerminalStatus{State: "inactive"}, nil
}
func (u *fakeUnit) TerminationEvidence(_ context.Context, cgroup string) (TerminationEvidence, error) {
	if cgroup != "/fake" {
		return TerminationEvidence{}, errors.New("unexpected cgroup")
	}
	return TerminationEvidence{ControlGroup: cgroup, Empty: true}, nil
}
func (u *fakeUnit) Cleanup(context.Context) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.cleaned = true
	return nil
}
func (u *fakeUnit) Stopped() bool { u.mu.Lock(); defer u.mu.Unlock(); return u.stopped }
func (u *fakeUnit) Cleaned() bool { u.mu.Lock(); defer u.mu.Unlock(); return u.cleaned }
