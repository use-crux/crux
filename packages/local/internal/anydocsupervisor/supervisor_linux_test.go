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
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
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
		"unknown nested fact":  bytes.Replace(valid, []byte(`"kind":"heading"`), []byte(`"kind":"heading","unknown":true`), 1),
		"source hash":          bytes.Replace(valid, []byte(request.SourceSHA256), []byte(strings.Repeat("d", 64)), 1),
		"producer":             bytes.Replace(valid, []byte(`"version":"0.1.7"`), []byte(`"version":"0.1.6"`), 1),
		"coordinate":           bytes.Replace(valid, []byte(`"documentSha256":"`+request.SourceSHA256+`"`), []byte(`"documentSha256":"`+strings.Repeat("d", 64)+`"`), 2),
		"block fact path":      bytes.Replace(valid, []byte(`:document/block:1"`), []byte(`:document/block:2"`), 1),
		"observed block count": bytes.Replace(valid, []byte(`"blockCount":1`), []byte(`"blockCount":2`), 1),
		"native block count":   bytes.Replace(valid, []byte(`"block-count","count":1`), []byte(`"block-count","count":2`), 1),
	}
	for name, payload := range mutations {
		t.Run(name, func(t *testing.T) {
			if _, err := recomputePayloadAccounting(request, payload); err == nil {
				t.Fatal("mutated nested evidence accepted")
			}
		})
	}
}

func TestAdmissionResultClosesNoteKinds(t *testing.T) {
	request := validTestRequest(FormatDOCX)
	valid := validAdmissionPayload(request)
	valid = bytes.Replace(valid, []byte(`"noteCount":0`), []byte(`"noteCount":1`), 1)
	valid = bytes.Replace(valid, []byte(`{\"notes\":[]`), []byte(`{\"notes\":[{\"id\":\"n1\",\"kind\":\"footnote\"}]`), 1)
	if _, err := recomputePayloadAccounting(request, valid); err != nil {
		t.Fatalf("valid footnote rejected: %v", err)
	}
	if _, err := recomputePayloadAccounting(request, bytes.Replace(valid, []byte(`\"footnote\"`), []byte(`\"comment\"`), 1)); err == nil {
		t.Fatal("open note kind accepted")
	}
}

func TestAdmissionResultRequiresNativeEvidenceForEveryTableDescendant(t *testing.T) {
	request := validTestRequest(FormatDOCX)
	valid := validAdmissionPayloadWithTableDescendant(request)
	if _, err := recomputePayloadAccounting(request, valid); err != nil {
		t.Fatalf("valid table descendant rejected: %v", err)
	}
	mutations := map[string][]byte{
		"cell provenance":     bytes.Replace(valid, []byte(`"path":"blocks/1/rows/1/columns/1"`), []byte(`"path":"blocks/1/rows/1/columns/2"`), 1),
		"child block marker":  bytes.Replace(valid, []byte(`{"kind":"block","factPath":"blocks/1/rows/1/columns/1/blocks/1"},`), nil, 1),
		"nested list marker":  bytes.Replace(valid, []byte(`{"kind":"block","factPath":"blocks/1/rows/1/columns/1/blocks/1/items/1/blocks/1"},`), nil, 1),
		"nested child id":     bytes.Replace(valid, []byte(`column:1/block:1/item:1/block:1"`), []byte(`column:1/block:1/item:1/block:2"`), 1),
		"nested child text":   bytes.Replace(valid, []byte(`"text":"nested"`), []byte(`"text":"forged"`), 1),
		"table cell id":       bytes.Replace(valid, []byte(`:row:1:column:1"`), []byte(`:row:1:column:2"`), 1),
		"nested list item id": bytes.Replace(valid, []byte(`:2:document/block:1/row:1/column:1/block:1:item:1"`), []byte(`:2:document/block:1/row:1/column:1/block:1:item:2"`), 1),
	}
	for name, payload := range mutations {
		t.Run(name, func(t *testing.T) {
			if _, err := recomputePayloadAccounting(request, payload); err == nil {
				t.Fatal("unbound table descendant accepted")
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
	facts := fmt.Sprintf(`[{"kind":"ordered-text","text":[],"factPath":"document"},{"kind":"notes","text":[],"factPath":"document"},{"kind":"asset-count","count":0,"factPath":"document"},{"kind":"block-count","count":0,"factPath":"document"},{"kind":"coordinate-kinds","kinds":["document"],"factPath":"document"},{"kind":"no-parser-downgrade","factPath":"document"},{"kind":"provenance","path":"document","coordinate":%s,"producer":%s,"factPath":"document"}]`, coordinate, producer)
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
	facts := fmt.Sprintf(`{"kind":"block","factPath":"blocks/1"},{"kind":"block-text","text":"Title","factPath":"blocks/1"},{"kind":"heading","level":1,"text":"Title","factPath":"blocks/1"},{"kind":"provenance","path":"blocks/1","coordinate":%s,"producer":%s,"factPath":"blocks/1"},`, coordinate, producer)
	payload = strings.Replace(payload, `"blockCount":0`, `"blockCount":1`, 1)
	payload = strings.Replace(payload, `"block-count","count":0`, `"block-count","count":1`, 1)
	payload = strings.Replace(payload, `"facts":[`, `"facts":[`+facts, 1)
	block := fmt.Sprintf(`{"id":"anydoc:%s:1:document/block:1","kind":"text","coordinate":%s,"headingPath":[],"producer":%s,"role":"heading","text":"Title","inlines":[{"kind":"text","text":"Title","coordinate":%s,"producer":%s}],"level":1}`, request.SourceSHA256, coordinate, producer, coordinate, producer)
	payload = strings.Replace(payload, `"blocks":[]`, `"blocks":[`+block+`]`, 1)
	return []byte(payload)
}

func validAdmissionPayloadWithTableDescendant(request Request) []byte {
	payload := string(validAdmissionPayload(request))
	producer := `{"kind":"parser","name":"anydoc","version":"0.1.7","adapterVersion":"2-admission"}`
	coordinate := fmt.Sprintf(`{"kind":"document","documentSha256":%q}`, request.SourceSHA256)
	paths := []string{"blocks/1", "blocks/1/rows/1/columns/1/blocks/1", "blocks/1/rows/1/columns/1/blocks/1/items/1/blocks/1"}
	facts := ""
	for _, path := range paths {
		facts += fmt.Sprintf(`{"kind":"block","factPath":%q},{"kind":"provenance","path":%q,"coordinate":%s,"producer":%s,"factPath":%q},`, path, path, coordinate, producer, path)
	}
	cellPath := "blocks/1/rows/1/columns/1"
	facts += fmt.Sprintf(`{"kind":"provenance","path":%q,"coordinate":%s,"producer":%s,"factPath":%q},{"kind":"table","columns":[],"rows":[["nested"]],"factPath":"blocks/1"},{"kind":"list","ordered":false,"depth":1,"text":["nested"],"factPath":"blocks/1/rows/1/columns/1/blocks/1"},`, cellPath, coordinate, producer, cellPath)
	facts += `{"kind":"block-text","text":"nested","factPath":"blocks/1/rows/1/columns/1/blocks/1/items/1/blocks/1"},`
	payload = strings.Replace(payload, `"blockCount":0`, `"blockCount":3`, 1)
	payload = strings.Replace(payload, `"block-count","count":0`, `"block-count","count":3`, 1)
	payload = strings.Replace(payload, `"facts":[`, `"facts":[`+facts, 1)
	paragraph := fmt.Sprintf(`{"id":"anydoc:%s:3:document/block:1/row:1/column:1/block:1/item:1/block:1","kind":"text","coordinate":%s,"headingPath":[],"producer":%s,"role":"paragraph","text":"nested","inlines":[{"kind":"text","text":"nested","coordinate":%s,"producer":%s}]}`, request.SourceSHA256, coordinate, producer, coordinate, producer)
	listID := fmt.Sprintf("anydoc:%s:2:document/block:1/row:1/column:1/block:1", request.SourceSHA256)
	list := fmt.Sprintf(`{"id":%q,"kind":"list","coordinate":%s,"headingPath":[],"producer":%s,"ordered":false,"items":[{"id":%q,"coordinate":%s,"producer":%s,"blocks":[%s]}]}`, listID, coordinate, producer, listID+":item:1", coordinate, producer, paragraph)
	table := fmt.Sprintf(`{"id":"anydoc:%s:1:document/block:1","kind":"table","coordinate":%s,"headingPath":[],"producer":%s,"columns":[],"headerRows":0,"rows":[[{"id":"anydoc:%s:1:document/block:1:row:1:column:1","coordinate":%s,"producer":%s,"row":1,"column":1,"rowSpan":1,"columnSpan":1,"blocks":[%s],"displayedValue":""}]]}`, request.SourceSHA256, coordinate, producer, request.SourceSHA256, coordinate, producer, list)
	payload = strings.Replace(payload, `"blocks":[]`, `"blocks":[`+table+`]`, 1)
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
func TestReceiveResultPreservesTypedErrorOverExpiredContext(t *testing.T) {
	typed := closedWith(ErrInvalidResult, resultValidation("request-binding", "mismatch"))
	b := &fakeBackend{receive: func(ctx context.Context, _ Request) (Result, error) {
		return Result{}, typed
	}}
	r, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = r.ReceiveResult(ctx)
	var sup *SupervisorError
	if !errors.As(err, &sup) || sup.Code != ErrInvalidResult {
		t.Fatalf("typed error overwritten by ctx cancellation: %T %v", err, err)
	}
	var validation *ResultValidationError
	if !errors.As(err, &validation) || validation.Stage != "request-binding" || validation.ReasonCode != "mismatch" {
		t.Fatalf("inner ResultValidationError lost: %T %v", err, err)
	}

	deadlineErr := closedWith(ErrInvalidResult, resultValidation("ack-write", "io"))
	b2 := &fakeBackend{receive: func(ctx context.Context, _ Request) (Result, error) {
		return Result{}, deadlineErr
	}}
	r2, err := newTestSupervisor(t, b2).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	deadlineCtx, deadlineCancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Hour))
	defer deadlineCancel()
	_, err = r2.ReceiveResult(deadlineCtx)
	if !errors.As(err, &sup) || sup.Code != ErrInvalidResult {
		t.Fatalf("typed error overwritten by ctx deadline: %T %v", err, err)
	}
	if !errors.As(err, &validation) || validation.Stage != "ack-write" || validation.ReasonCode != "io" {
		t.Fatalf("inner ResultValidationError lost for deadline: %T %v", err, err)
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

func TestPIDLimitProfilesRemainDistinct(t *testing.T) {
	production := (Limits{}).Clamp()
	if production.TasksMax != 32 || jobLimits(production).PIDs != 32 {
		t.Fatalf("production PID ceiling = %d/%d, want 32/32", production.TasksMax, jobLimits(production).PIDs)
	}

	admission, err := (AdmissionHarnessLimits{MemoryMax: 128 << 20, TasksMax: 16, CPUQuotaPercent: 30, RuntimeMax: 10 * time.Second}).supervisorLimits()
	if err != nil || admission.TasksMax != 16 || jobLimits(admission).PIDs != 16 {
		t.Fatalf("admission PID ceiling = %d/%d, %v; want 16/16", admission.TasksMax, jobLimits(admission).PIDs, err)
	}
	if _, err := (AdmissionHarnessLimits{MemoryMax: 128 << 20, TasksMax: 17, CPUQuotaPercent: 30, RuntimeMax: 10 * time.Second}).supervisorLimits(); err == nil {
		t.Fatal("admission accepted more than half the production PID ceiling")
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

// TestStagedSourceGrantsExactDynamicUserAccess locks the ownership contract the
// systemd DynamicUser needs: after containment verification, only the exact
// staged inode may be handed to the verified worker UID at mode 0400 while the
// host parent directory stays private (0700) and foreign/swapped inodes are refused.
func TestStagedSourceGrantsExactDynamicUserAccess(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	stager := NewStager(root)
	const payload = "grant-source-bytes"
	staged, err := stager.Stage([]byte(payload), 64)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = staged.Cleanup() })

	parentBefore, err := os.Lstat(filepath.Dir(staged.HostPath))
	if err != nil || !parentBefore.IsDir() || parentBefore.Mode().Perm() != 0700 {
		t.Fatalf("parent before grant = %#v, %v", parentBefore, err)
	}
	parentOwnerBefore := fileOwner(t, parentBefore)
	fileBefore, err := os.Lstat(staged.HostPath)
	if err != nil || fileBefore.Mode().Perm() != 0400 || !fileBefore.Mode().IsRegular() {
		t.Fatalf("staged source before grant = %#v, %v", fileBefore, err)
	}
	identityBefore := fileIdentity(t, fileBefore)

	uid := uint32(os.Getuid())
	if uid == 0 {
		uid = 65534
	}
	if err := staged.GrantAccess(uid); err != nil {
		t.Fatalf("grant verified worker access: %v", err)
	}

	fileAfter, err := os.Lstat(staged.HostPath)
	if err != nil || fileAfter.Mode().Perm() != 0400 || !fileAfter.Mode().IsRegular() {
		t.Fatalf("staged source after grant = %#v, %v", fileAfter, err)
	}
	identityAfter := fileIdentity(t, fileAfter)
	if identityAfter.dev != identityBefore.dev || identityAfter.ino != identityBefore.ino || identityAfter.size != identityBefore.size {
		t.Fatalf("grant mutated inode identity: before=%#v after=%#v", identityBefore, identityAfter)
	}
	if got := fileOwner(t, fileAfter); got.uid != uid || got.gid != uid {
		t.Fatalf("staged source owner = %#v, want uid=gid=%d (exact requested DynamicUser)", got, uid)
	}

	parentAfter, err := os.Lstat(filepath.Dir(staged.HostPath))
	if err != nil || parentAfter.Mode().Perm() != 0700 || !parentAfter.IsDir() {
		t.Fatalf("parent after grant = %#v, %v", parentAfter, err)
	}
	if got := fileOwner(t, parentAfter); got != parentOwnerBefore {
		t.Fatalf("parent ownership changed: before=%#v after=%#v", parentOwnerBefore, got)
	}

	if err := staged.GrantAccess(0); err == nil {
		t.Fatal("uid 0 grant accepted")
	}

	// Symlink substitution at the staged path must fail closed (O_NOFOLLOW).
	swapped := t.TempDir() + "/swapped"
	if err := os.WriteFile(swapped, []byte(payload), 0400); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(staged.HostPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(swapped, staged.HostPath); err != nil {
		t.Fatal(err)
	}
	if err := staged.GrantAccess(uid); err == nil {
		t.Fatal("symlink-substituted staged source accepted")
	}

	// Exact-path foreign bind must not authorize a grant for this staged inode.
	foreign := &fakeUnit{rep: SandboxReport{
		MainPID: 42, UID: uint64(uid), DynamicUser: true, PrivateUsers: true,
		ProtectProc: "invisible", ProcSubset: "pid",
		BindReadOnlyPaths: []string{"/run/foreign:" + stagedSourceTarget},
	}}
	if err := grantVerifiedSourceAccess(context.Background(), foreign, staged); err == nil {
		t.Fatal("foreign-unit bind path accepted for staged source grant")
	}
}

// TestInspectStagedSourceFDRejectsStatDriftDuringHash is the TOCTOU regression
// for inspectStagedSourceFD: a single pre-hash fstat is not enough. Metadata
// (ctime via same-mode fchmod) must not be allowed to change across the hash.
func TestInspectStagedSourceFDRejectsStatDriftDuringHash(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	// Multi-chunk payload widens the hash window so concurrent ctime churn is observable.
	payload := bytes.Repeat([]byte("staged-source-drift-"), 64<<10)
	staged, err := NewStager(root).Stage(payload, int64(len(payload)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = staged.Cleanup() })

	mutFD, err := unix.Open(staged.HostPath, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(mutFD)

	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				// Mode stays 0400; Linux still advances ctime on a successful chmod.
				_ = unix.Fchmod(mutFD, 0400)
			}
		}
	}()
	defer func() {
		close(stop)
		wg.Wait()
	}()

	// Head start so ctime is already moving before the first fstat.
	time.Sleep(5 * time.Millisecond)

	fd, err := unix.Open(staged.HostPath, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(fd)

	// Without pre/post fstat equality, inspect returns success under ctime churn.
	// With the fix, any dev/ino/size/mode/uid/gid/mtime/ctime drift fails closed.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := inspectStagedSourceFD(fd, staged.size, staged.hash, staged.size); err != nil {
			return
		}
	}
	t.Fatal("stat drift during hash accepted")
}
func TestExecutePreservesResultValidationCauseThroughCleanupFailure(t *testing.T) {
	validation := resultValidation("request-binding", "mismatch")
	typed := closedWith(ErrInvalidResult, validation)
	b := &fakeBackend{
		cleanupErr: errors.New("cleanup failed"),
		receive: func(ctx context.Context, _ Request) (Result, error) {
			return Result{}, typed
		},
	}
	r, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.Execute(context.Background())
	var sup *SupervisorError
	if !errors.As(err, &sup) || sup.Code != ErrContainmentUnavailable {
		t.Fatalf("outer error = %T %v, want containmnent-unavailable", err, err)
	}
	var v *ResultValidationError
	if !errors.As(err, &v) {
		t.Fatalf("ResultValidationError cause lost through cleanup: %T %v", err, err)
	}
	if v.Stage != "request-binding" || v.ReasonCode != "mismatch" {
		t.Fatalf("ResultValidationError = {stage:%q reason:%q}", v.Stage, v.ReasonCode)
	}
	got := safeExecutionFailure(err, r.TerminalReport())
	const want = "error=invalid-result outcome=containment-unavailable service=unknown stage=request-binding reason=mismatch oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
}

func TestExecutePrefersResultReceiveContainmentOverCleanupFailure(t *testing.T) {
	receive := closedWith(ErrContainmentUnavailable, &ContainmentError{Stage: "result-receive", ReasonCode: "io"})
	b := &fakeBackend{
		cleanupErr: errors.New("cleanup failed"),
		receive: func(ctx context.Context, _ Request) (Result, error) {
			return Result{}, receive
		},
	}
	r, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.Execute(context.Background())
	got := safeExecutionFailure(err, r.TerminalReport())
	const want = "error=containment-unavailable outcome=containment-unavailable service=unknown stage=result-receive reason=io oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
}

func TestExecuteYieldsCleanupDiagnosisWhenServiceSucceeds(t *testing.T) {
	b := &fakeBackend{
		cleanupErr: errors.New("cleanup failed"),
		receive: func(ctx context.Context, req Request) (Result, error) {
			return Result{Request: req, OK: true}, nil
		},
	}
	r, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.Execute(context.Background())
	var sup *SupervisorError
	if !errors.As(err, &sup) || sup.Code != ErrContainmentUnavailable {
		t.Fatalf("outer error = %T %v, want containment-unavailable", err, err)
	}
	var validation *ResultValidationError
	if errors.As(err, &validation) {
		t.Fatalf("pure cleanup must not carry ResultValidationError: %#v", validation)
	}
	var containment *ContainmentError
	if !errors.As(err, &containment) {
		t.Fatalf("ContainmentError missing after successful service + cleanup failure: %T %v", err, err)
	}
	if containment.Stage != "containment-cleanup" || containment.ReasonCode != "unit-cleanup" {
		t.Fatalf("ContainmentError = {stage:%q reason:%q}", containment.Stage, containment.ReasonCode)
	}
	got := safeExecutionFailure(err, r.TerminalReport())
	const want = "error=containment-unavailable outcome=containment-unavailable service=unknown stage=containment-cleanup reason=unit-cleanup oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
}

func TestFinishNilYieldsCleanupDiagnosis(t *testing.T) {
	b := &fakeBackend{cleanupErr: errors.New("cleanup failed")}
	r, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	err = r.Finish(context.Background(), nil)
	got := safeExecutionFailure(err, r.TerminalReport())
	const want = "error=containment-unavailable outcome=containment-unavailable service=unknown stage=containment-cleanup reason=unit-cleanup oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
}

func TestFinishNilWithUnitAndStagedCleanupFailuresPreservesFirstReason(t *testing.T) {
	b := &fakeBackend{cleanupErr: errors.New("unit cleanup failed")}
	r, err := newTestSupervisor(t, b).startEvaluation(context.Background(), []byte("x"), FormatDOCX, testLaunch(), "/run/tmp", Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if err := r.staged.Cleanup(); err != nil {
		t.Fatalf("prepare staged cleanup failure: %v", err)
	}
	r.staged = &StagedSource{HostPath: "unsafe", dir: "unsafe"}

	err = r.Finish(context.Background(), nil)
	var chain *containmentCleanupChain
	if errors.As(err, &chain) {
		t.Fatalf("pure cleanup must not use a pre-cleanup carrier: %#v", chain)
	}
	var containment *ContainmentError
	if !errors.As(err, &containment) {
		t.Fatalf("ContainmentError missing: %T %v", err, err)
	}
	if containment.Stage != "containment-cleanup" || containment.ReasonCode != "unit-cleanup" {
		t.Fatalf("ContainmentError = {stage:%q reason:%q}", containment.Stage, containment.ReasonCode)
	}
}

func TestCleanupUsesTypedStopFailureOnlyWithoutEarlierReason(t *testing.T) {
	for _, test := range []struct {
		name       string
		cpuErr     bool
		wantReason string
	}{
		{name: "typed stop failure", wantReason: "unit-properties-unavailable"},
		{name: "earlier accounting failure", cpuErr: true, wantReason: "accounting-evidence"},
	} {
		t.Run(test.name, func(t *testing.T) {
			unit := &fakeUnit{
				rep:     SandboxReport{ControlGroup: "/fake"},
				cpuErr:  test.cpuErr,
				stopErr: &stopFailure{reason: "unit-properties-unavailable"},
			}
			_, _, _, reason := cleanup(unit)
			if reason != test.wantReason {
				t.Fatalf("cleanup reason = %q, want %q", reason, test.wantReason)
			}
		})
	}
}

func TestCleanupClassifiesUnitPropertiesGonePromotion(t *testing.T) {
	const pinnedCgroup = "/private/pinned-cgroup-secret"
	const snapshotCgroup = "/private/snapshot-cgroup-secret"
	successfulSnapshot := SandboxReport{MainPID: 0, ControlGroup: pinnedCgroup, ServiceResult: "success", ExecMainStatus: 0}

	for _, test := range []struct {
		name       string
		pinned     string
		snapshot   SandboxReport
		verified   bool
		statusGone bool
		want       string
	}{
		{name: "no verified snapshot", pinned: pinnedCgroup, want: "unit-properties-gone-no-verified-snapshot"},
		{name: "missing snapshot cgroup", pinned: pinnedCgroup, snapshot: SandboxReport{MainPID: 0, ServiceResult: "success"}, verified: true, want: "unit-properties-gone-snapshot-cgroup"},
		{name: "invalid snapshot cgroup", pinned: pinnedCgroup, snapshot: SandboxReport{MainPID: 0, ControlGroup: "relative-snapshot-secret", ServiceResult: "success"}, verified: true, want: "unit-properties-gone-snapshot-cgroup"},
		{name: "mismatched snapshot cgroup", pinned: pinnedCgroup, snapshot: SandboxReport{MainPID: 0, ControlGroup: snapshotCgroup, ServiceResult: "success"}, verified: true, want: "unit-properties-gone-snapshot-cgroup"},
		{name: "invalid pinned cgroup", pinned: "relative-pinned-secret", snapshot: SandboxReport{MainPID: 0, ControlGroup: "relative-pinned-secret", ServiceResult: "success"}, verified: true, want: "unit-properties-gone-snapshot-cgroup"},
		{name: "live snapshot", pinned: pinnedCgroup, snapshot: SandboxReport{MainPID: 42, ControlGroup: pinnedCgroup, ServiceResult: "success"}, verified: true, want: "unit-properties-gone-snapshot-not-success"},
		{name: "failed snapshot", pinned: pinnedCgroup, snapshot: SandboxReport{MainPID: 0, ControlGroup: pinnedCgroup, ServiceResult: "exit-code", ExecMainStatus: 1}, verified: true, want: "unit-properties-gone-snapshot-not-success"},
		{name: "nonzero status snapshot", pinned: pinnedCgroup, snapshot: SandboxReport{MainPID: 0, ControlGroup: pinnedCgroup, ServiceResult: "success", ExecMainStatus: 1}, verified: true, want: "unit-properties-gone-snapshot-not-success"},
		{name: "successful promotion unchanged", pinned: pinnedCgroup, snapshot: successfulSnapshot, verified: true, statusGone: true, want: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			unit := &fakeUnit{
				rep:        SandboxReport{ControlGroup: test.pinned},
				stopErr:    &stopFailure{reason: "unit-properties-gone"},
				snapshot:   test.snapshot,
				snapshotOK: test.verified,
				termination: func(context.Context, string) (TerminationEvidence, error) {
					return TerminationEvidence{ControlGroup: test.pinned, Absent: true}, nil
				},
			}
			if test.statusGone {
				unit.terminalStatus = func(context.Context) (TerminalStatus, error) {
					return TerminalStatus{}, &terminalStatusGoneError{}
				}
			}

			_, _, _, reason := cleanup(unit)
			if reason != test.want {
				t.Fatalf("cleanup reason = %q, want %q", reason, test.want)
			}
			if reason != "" && !validContainmentReason(reason) {
				t.Fatalf("cleanup reason %q is not allowlisted", reason)
			}
			if strings.Contains(reason, "private") || strings.Contains(reason, "secret") || strings.Contains(reason, "relative") {
				t.Fatalf("cleanup reason leaked sensitive detail: %q", reason)
			}
		})
	}
}

func TestValidateAlreadyGoneReasonsAreFixedAndSafe(t *testing.T) {
	success := TerminalStatus{State: "inactive", ServiceResult: "success"}
	secret := "/private/cgroup/tenant-123: dbus details"
	for _, test := range []struct {
		name           string
		termination    TerminationEvidence
		terminationErr error
		status         TerminalStatus
		statusErr      error
		alreadyGone    *alreadyGoneError
		want           string
	}{
		{
			name:           "termination error",
			termination:    TerminationEvidence{ControlGroup: "/safe"},
			terminationErr: errors.New(secret),
			status:         success,
			alreadyGone:    &alreadyGoneError{proof: success, cgroup: "/safe"},
			want:           "already-gone-termination-unavailable",
		},
		{
			name:        "empty cgroup",
			status:      success,
			alreadyGone: &alreadyGoneError{proof: success, cgroup: "/safe"},
			want:        "already-gone-termination-unavailable",
		},
		{
			name:        "termination mismatch",
			termination: TerminationEvidence{ControlGroup: "/safe"},
			status:      success,
			alreadyGone: &alreadyGoneError{proof: success, cgroup: "/safe"},
			want:        "already-gone-termination-mismatch",
		},
		{
			name:        "termination not exclusive",
			termination: TerminationEvidence{ControlGroup: "/safe", Absent: true, Empty: true},
			status:      success,
			alreadyGone: &alreadyGoneError{proof: success, cgroup: "/safe"},
			want:        "already-gone-termination-not-exclusive",
		},
		{
			name:        "terminal unavailable",
			termination: TerminationEvidence{ControlGroup: "/safe", Absent: true},
			status:      success,
			statusErr:   errors.New(secret),
			alreadyGone: &alreadyGoneError{proof: success, cgroup: "/safe"},
			want:        "already-gone-terminal-unavailable",
		},
		{
			name:        "terminal not success",
			termination: TerminationEvidence{ControlGroup: "/safe", Empty: true},
			status:      TerminalStatus{State: "failed", ServiceResult: "exit-code", ExecMainStatus: 1},
			alreadyGone: &alreadyGoneError{proof: success, cgroup: "/safe"},
			want:        "already-gone-terminal-not-success",
		},
		{
			name:        "success",
			termination: TerminationEvidence{ControlGroup: "/safe", Absent: true},
			status:      success,
			alreadyGone: &alreadyGoneError{proof: success, cgroup: "/safe"},
			want:        "",
		},
		{
			name:        "forged non-strict proof",
			termination: TerminationEvidence{ControlGroup: "/safe", Absent: true},
			statusErr:   &terminalStatusGoneError{},
			alreadyGone: &alreadyGoneError{proof: TerminalStatus{State: "inactive", ServiceResult: "success", ExecMainStatus: 1}, cgroup: "/safe"},
			want:        "already-gone-terminal-unavailable",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := validateAlreadyGone("/safe", test.termination, test.terminationErr, test.status, test.statusErr, test.alreadyGone)
			if got != test.want {
				t.Fatalf("validateAlreadyGone() = %q, want %q", got, test.want)
			}
			if strings.Contains(got, secret) {
				t.Fatalf("reason leaked sensitive detail: %q", got)
			}
			if got != "" && !validContainmentReason(got) {
				t.Fatalf("reason is not safe-cleanup allowlisted: %q", got)
			}
		})
	}
}

func TestChainContainmentNilCarriesContainmentNotResultValidation(t *testing.T) {
	err := chainContainment(nil, false, "containment-cleanup", "accounting-evidence")
	if errorCode(err) != ErrContainmentUnavailable {
		t.Fatalf("code = %q", errorCode(err))
	}
	var validation *ResultValidationError
	if errors.As(err, &validation) {
		t.Fatalf("nil-result cleanup used ResultValidationError carrier: %#v", validation)
	}
	var containment *ContainmentError
	if !errors.As(err, &containment) || containment.Stage != "containment-cleanup" || containment.ReasonCode != "accounting-evidence" {
		t.Fatalf("ContainmentError = %#v", containment)
	}
	got := safeExecutionFailure(err, TerminalReport{Outcome: ErrContainmentUnavailable, PreStop: SandboxReport{ServiceResult: "success"}})
	const want = "error=containment-unavailable outcome=containment-unavailable service=success stage=containment-cleanup reason=accounting-evidence oom-killed=false pids-limited=false"
	if got != want {
		t.Fatalf("diagnostic mismatch: got %q want %q", got, want)
	}
}

func assert(t *testing.T, e error, c ErrorCode) {
	t.Helper()
	var x *SupervisorError
	if !errors.As(e, &x) || x.Code != c {
		t.Fatalf("%v", e)
	}
}

type fileOwnerIDs struct{ uid, gid uint32 }

func fileOwner(t *testing.T, info os.FileInfo) fileOwnerIDs {
	t.Helper()
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatalf("missing stat identity for %s", info.Name())
	}
	return fileOwnerIDs{uid: stat.Uid, gid: stat.Gid}
}

type fileIdent struct {
	dev, ino uint64
	size     int64
}

func fileIdentity(t *testing.T, info os.FileInfo) fileIdent {
	t.Helper()
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatalf("missing stat identity for %s", info.Name())
	}
	return fileIdent{dev: uint64(stat.Dev), ino: stat.Ino, size: info.Size()}
}

type fakeBackend struct {
	u          *fakeUnit
	read       *os.File
	bad        bool
	cpu        time.Duration
	cpuErr     bool
	cleanupErr error
	receive    func(context.Context, Request) (Result, error)
}

func (b *fakeBackend) Start(_ context.Context, s ServiceSpec, r *os.File) (Unit, error) {
	b.read = r
	rep := SandboxReport{MainPID: 42, ControlGroup: "/fake", RuntimeTreeDigest: s.runtimeTreeDigest, UID: 1000, DynamicUser: true, PrivateUsers: true, ProtectProc: "invisible", ProcSubset: "pid", ControlGroupMembers: []int{42}, MemoryMax: s.MemoryMax, MemorySwapMax: 0, TasksMax: s.TasksMax, CPUQuotaPercent: s.CPUQuotaPercent, CPUQuotaPeriodUSec: s.CPUQuotaPeriodUSec, RuntimeMax: s.RuntimeMax, KillMode: s.KillMode, ProtectSystem: s.ProtectSystem, CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true, CapabilityBoundingSet: 0, AmbientCapabilities: 0, ReadOnlyPaths: s.ReadOnlyPaths, InaccessiblePaths: s.InaccessiblePaths, BindReadOnlyPaths: s.BindReadOnlyPaths, ReadWritePaths: s.ReadWritePaths, RestrictAddressFamiliesAllow: true, RestrictAddressFamilies: s.RestrictAddressFamilies, Populated: true}
	if b.bad {
		rep.MemoryMax = 1
	}
	b.u = &fakeUnit{rep: rep, cpu: b.cpu, cpuErr: b.cpuErr, cleanupErr: b.cleanupErr, receive: b.receive}
	return b.u, nil
}

type fakeUnit struct {
	rep              SandboxReport
	cpu              time.Duration
	cpuErr           bool
	receive          func(context.Context, Request) (Result, error)
	cleanupErr       error
	stopErr          error
	termination      func(context.Context, string) (TerminationEvidence, error)
	terminalStatus   func(context.Context) (TerminalStatus, error)
	snapshot         SandboxReport
	snapshotCPU      time.Duration
	snapshotOK       bool
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
	return u.stopErr
}
func (u *fakeUnit) WaitInactive(context.Context) error { return nil }
func (u *fakeUnit) TerminalStatus(ctx context.Context) (TerminalStatus, error) {
	if u.terminalStatus != nil {
		return u.terminalStatus(ctx)
	}
	return TerminalStatus{State: "inactive"}, nil
}
func (u *fakeUnit) TerminationEvidence(ctx context.Context, cgroup string) (TerminationEvidence, error) {
	if u.termination != nil {
		return u.termination(ctx, cgroup)
	}
	if cgroup != "/fake" {
		return TerminationEvidence{}, errors.New("unexpected cgroup")
	}
	return TerminationEvidence{ControlGroup: cgroup, Empty: true}, nil
}
func (u *fakeUnit) Cleanup(context.Context) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.cleaned = true
	return u.cleanupErr
}
func (u *fakeUnit) MarkSnapshotVerified() {}
func (u *fakeUnit) LastVerifiedSnapshot() (SandboxReport, time.Duration, bool) {
	return u.snapshot, u.snapshotCPU, u.snapshotOK
}
func (u *fakeUnit) Stopped() bool { u.mu.Lock(); defer u.mu.Unlock(); return u.stopped }
func (u *fakeUnit) Cleaned() bool { u.mu.Lock(); defer u.mu.Unlock(); return u.cleaned }
