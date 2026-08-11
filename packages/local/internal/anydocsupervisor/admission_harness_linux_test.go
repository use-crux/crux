//go:build linux

package anydocsupervisor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAdmissionHarnessRunsFreshSequentialColdAndWarmEvidence(t *testing.T) {
	t.Setenv(admissionHarnessEnv, "1")
	backend := &harnessBackend{}
	supervisor := newTestSupervisor(t, backend)
	launch, packageHash, codeHash := harnessLaunch(t)
	input := []byte("fixture")
	source := sha256Hex(input)
	caseInput := AdmissionFixtureCase{
		ID:            "docx-structure-v1",
		Bytes:         input,
		Format:        FormatDOCX,
		SourceSHA256:  source,
		PackageSHA256: packageHash,
		RuntimeSHA256: strings.Repeat("d", 64),
		CodeSHA256:    codeHash,
	}

	report, err := RunAdmissionHarness(context.Background(), supervisor, launch, t.TempDir(), []AdmissionFixtureCase{caseInput}, AdmissionHarnessLimits{MemoryMax: 128 << 20, TasksMax: 16, CPUQuotaPercent: 30, RuntimeMax: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if backend.starts != 8 || backend.maxActive != 1 {
		t.Fatalf("starts=%d maxActive=%d, want 8 sequential fresh units", backend.starts, backend.maxActive)
	}
	if len(report.Fixtures) != 1 || len(report.Fixtures[0].Cold) != 3 || len(report.Fixtures[0].Warm) != 5 {
		t.Fatalf("unexpected repetition report: %#v", report)
	}
	if !report.Fixtures[0].RolloutBudgetGate || report.Fixtures[0].P95.MemoryPeakBytes != 1024 || report.Fixtures[0].P95.CPUMilliseconds != 5 {
		t.Fatalf("fixture p95 rollout evidence missing: %#v", report.Fixtures[0])
	}
	first := report.Fixtures[0].First
	if first == nil || first.NativeSHA256 == "" || first.CoreSHA256 == "" || len(first.Facts) == 0 || first.Facts[0].FactPathSHA256 == "" {
		t.Fatalf("first-run compact facts missing: %#v", first)
	}
	allRuns := append(append([]AdmissionRunEvidence(nil), report.Fixtures[0].Cold...), report.Fixtures[0].Warm...)
	for index, run := range allRuns {
		if run.NativeSHA256 != first.NativeSHA256 || run.CoreSHA256 != first.CoreSHA256 {
			t.Fatalf("run %d projection hashes = %q/%q, want %q/%q", index, run.NativeSHA256, run.CoreSHA256, first.NativeSHA256, first.CoreSHA256)
		}
	}
	if report.Fixtures[0].Cold[0].RequestSHA256 == "" || report.Fixtures[0].Cold[0].MemoryPeakBytes != 1024 || !report.Fixtures[0].Cold[0].Cleaned || !report.Fixtures[0].Cold[0].TerminationEmpty {
		t.Fatalf("terminal accounting missing: %#v", report.Fixtures[0].Cold[0])
	}
	encoded, err := report.MarshalJSON()
	if err != nil || len(encoded) == 0 || len(encoded) > admissionEnvelopeMaxBytes {
		t.Fatalf("bounded envelope = %d bytes, %v", len(encoded), err)
	}
	if string(encoded) == "" || containsText(string(encoded), `"text":"Title"`) {
		t.Fatalf("envelope leaked document text: %s", encoded)
	}
	report.Fixtures[0].Warm[4].NativeSHA256 = ""
	if _, err := report.MarshalJSON(); err == nil {
		t.Fatal("missing per-run native projection hash accepted")
	}
	report.Fixtures[0].Warm[4].NativeSHA256 = strings.Repeat("a", 64)
	if _, err := report.MarshalJSON(); err == nil {
		t.Fatal("divergent per-run native projection hash accepted")
	}
}

func TestAdmissionHarnessRejectsUnboundOrOverBudgetInputs(t *testing.T) {
	t.Setenv(admissionHarnessEnv, "1")
	supervisor := newTestSupervisor(t, &harnessBackend{})
	launch, packageHash, codeHash := harnessLaunch(t)
	caseInput := AdmissionFixtureCase{ID: "bad", Bytes: []byte("x"), Format: FormatDOCX, SourceSHA256: testDigest('a'), PackageSHA256: packageHash, RuntimeSHA256: strings.Repeat("d", 64), CodeSHA256: codeHash}
	if _, err := RunAdmissionHarness(context.Background(), supervisor, launch, t.TempDir(), []AdmissionFixtureCase{caseInput}, AdmissionHarnessLimits{MemoryMax: 128 << 20, TasksMax: 16, CPUQuotaPercent: 30, RuntimeMax: 10 * time.Second}); err == nil {
		t.Fatal("unbound source accepted")
	}
	caseInput.SourceSHA256 = sha256Hex(caseInput.Bytes)
	if _, err := RunAdmissionHarness(context.Background(), supervisor, launch, t.TempDir(), []AdmissionFixtureCase{caseInput}, AdmissionHarnessLimits{MemoryMax: MemoryCeiling, TasksMax: 16, CPUQuotaPercent: 30, RuntimeMax: 10 * time.Second}); err == nil {
		t.Fatal("over-half rollout memory limit accepted")
	}
}

func TestAdmissionHarnessRequiresSystemdIntegrationGate(t *testing.T) {
	t.Setenv(admissionHarnessEnv, "")
	launch, packageHash, codeHash := harnessLaunch(t)
	caseInput := AdmissionFixtureCase{ID: "gated", Bytes: []byte("x"), Format: FormatDOCX, SourceSHA256: sha256Hex([]byte("x")), PackageSHA256: packageHash, RuntimeSHA256: strings.Repeat("d", 64), CodeSHA256: codeHash}
	if _, err := RunAdmissionHarness(context.Background(), newTestSupervisor(t, &harnessBackend{}), launch, t.TempDir(), []AdmissionFixtureCase{caseInput}, AdmissionHarnessLimits{MemoryMax: 128 << 20, TasksMax: 16, CPUQuotaPercent: 30, RuntimeMax: 10 * time.Second}); err == nil {
		t.Fatal("ungated harness execution accepted")
	}
}

func TestAdmissionHarnessUsesNearestRankP95AgainstEffectiveLimits(t *testing.T) {
	samples := []AdmissionRunEvidence{
		{MemoryPeakBytes: 1, CPUMilliseconds: 1, WallMilliseconds: 1},
		{MemoryPeakBytes: 2, CPUMilliseconds: 2, WallMilliseconds: 2},
		{MemoryPeakBytes: 3, CPUMilliseconds: 3, WallMilliseconds: 3},
		{MemoryPeakBytes: 4, CPUMilliseconds: 4, WallMilliseconds: 4},
		{MemoryPeakBytes: 5, CPUMilliseconds: 5, WallMilliseconds: 5},
		{MemoryPeakBytes: 6, CPUMilliseconds: 6, WallMilliseconds: 6},
		{MemoryPeakBytes: 7, CPUMilliseconds: 7, WallMilliseconds: 7},
		{MemoryPeakBytes: 99, CPUMilliseconds: 99, WallMilliseconds: 99},
	}
	p95 := admissionP95(samples)
	if p95.MemoryPeakBytes != 99 || p95.CPUMilliseconds != 99 || p95.WallMilliseconds != 99 {
		t.Fatalf("nearest-rank p95 = %#v", p95)
	}
	limits := JobLimits{MemoryBytes: 200, CPUMilliseconds: 200, WallMilliseconds: 200}
	if !withinAdmissionRolloutP95(p95, limits) {
		t.Fatal("p95 within half effective limits was rejected")
	}
	if withinAdmissionRolloutP95(AdmissionP95{MemoryPeakBytes: 101, CPUMilliseconds: 99, WallMilliseconds: 99}, limits) {
		t.Fatal("p95 above half effective memory limit accepted")
	}
}

func TestCompactFirstRunHashesCompleteNativeFacts(t *testing.T) {
	request := validTestRequest(FormatDOCX)
	baseline, err := compactFirstRun(validAdmissionPayloadWithBlock(request))
	if err != nil {
		t.Fatal(err)
	}
	mutatedPayload := bytes.Replace(validAdmissionPayloadWithBlock(request), []byte(`"level":1,"text":"Title"`), []byte(`"level":2,"text":"Changed"`), 1)
	mutated, err := compactFirstRun(mutatedPayload)
	if err != nil {
		t.Fatal(err)
	}
	if compactFactHash(baseline.Facts, "heading") == compactFactHash(mutated.Facts, "heading") {
		t.Fatal("value-only native heading mutation retained its compact fact hash")
	}
}

func compactFactHash(facts []AdmissionFact, kind string) string {
	for _, fact := range facts {
		if fact.Kind == kind {
			return fact.StructuralSHA256
		}
	}
	return ""
}

func testDigest(value byte) string {
	return hex.EncodeToString(bytesOf(value, sha256.Size))
}

func bytesOf(value byte, count int) []byte {
	result := make([]byte, count)
	for i := range result {
		result[i] = value
	}
	return result
}

func harnessLaunch(t *testing.T) (LaunchDependency, string, string) {
	t.Helper()
	root := t.TempDir()
	runner := []byte("export default 'runner'\n")
	packageJSON := []byte(`{"name":"@firecrawl/anydoc","version":"0.1.7"}`)
	packagePath := filepath.Join(root, "node_modules", "@firecrawl", "anydoc")
	if err := os.MkdirAll(packagePath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "runner.mjs"), runner, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packagePath, "package.json"), packageJSON, 0o600); err != nil {
		t.Fatal(err)
	}
	launch := testLaunch()
	launch.runtimeRoot = root
	launch.runtimeRunner = filepath.Join(root, "runner.mjs")
	return launch, sha256Hex(packageJSON), sha256Hex(runner)
}

func containsText(value, needle string) bool { return strings.Contains(value, needle) }

type harnessBackend struct {
	mu                        sync.Mutex
	starts, active, maxActive int
}

func (b *harnessBackend) Start(_ context.Context, spec ServiceSpec, read *os.File) (Unit, error) {
	b.mu.Lock()
	b.starts++
	b.active++
	if b.active > b.maxActive {
		b.maxActive = b.active
	}
	b.mu.Unlock()
	return &harnessUnit{fakeUnit: fakeUnit{rep: harnessReport(spec), cpu: 5 * time.Millisecond}, backend: b, read: read}, nil
}

type harnessUnit struct {
	fakeUnit
	backend *harnessBackend
	read    *os.File
}

func (u *harnessUnit) ReceiveResult(_ context.Context, request Request) (Result, error) {
	payload := validAdmissionPayloadWithBlock(request)
	accounting, err := recomputePayloadAccounting(request, payload)
	if err != nil {
		return Result{}, err
	}
	return Result{Request: request, OK: true, Payload: payload, Accounting: &accounting}, nil
}
func (u *harnessUnit) Cleanup(ctx context.Context) error {
	if err := u.fakeUnit.Cleanup(ctx); err != nil {
		return err
	}
	u.backend.mu.Lock()
	u.backend.active--
	u.backend.mu.Unlock()
	return nil
}

func harnessReport(spec ServiceSpec) SandboxReport {
	return SandboxReport{MainPID: 42, ControlGroup: "/fake", RuntimeTreeDigest: spec.runtimeTreeDigest, UID: 1000, DynamicUser: true, PrivateUsers: true, ProtectProc: "invisible", ProcSubset: "pid", ControlGroupMembers: []int{42}, MemoryMax: spec.MemoryMax, MemoryCurrent: 512, MemoryPeak: 1024, MemorySwapMax: 0, TasksMax: spec.TasksMax, CPUQuotaPercent: spec.CPUQuotaPercent, CPUQuotaPeriodUSec: spec.CPUQuotaPeriodUSec, RuntimeMax: spec.RuntimeMax, KillMode: spec.KillMode, ProtectSystem: spec.ProtectSystem, CPUAccounting: true, NoNewPrivileges: true, PrivateNetwork: true, PrivateTmp: true, ProtectHome: true, RestrictAddressFamiliesAllow: true, RestrictAddressFamilies: spec.RestrictAddressFamilies, ReadOnlyPaths: spec.ReadOnlyPaths, InaccessiblePaths: spec.InaccessiblePaths, BindReadOnlyPaths: spec.BindReadOnlyPaths, BindPaths: bindPathsForSpec(spec), ReadWritePaths: spec.ReadWritePaths, Populated: true}
}
