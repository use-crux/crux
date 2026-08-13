//go:build linux

package anydocsupervisor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// This harness is deliberately an internal evaluation seam. It uses the same
// systemd-backed Supervisor as production, while Start remains closed until a
// separately reviewed admission decision enables a format.
const admissionEnvelopeMaxBytes = 512 << 10
const admissionHarnessEnv = "CRUX_SYSTEMD_INTEGRATION"

type AdmissionFixtureCase struct {
	ID            string
	Bytes         []byte
	Format        Format
	SourceSHA256  string
	PackageSHA256 string
	RuntimeSHA256 string
	CodeSHA256    string
}

type AdmissionHarnessLimits struct {
	MemoryMax       int64
	TasksMax        int
	CPUQuotaPercent int
	RuntimeMax      time.Duration
}

func (l AdmissionHarnessLimits) supervisorLimits() (Limits, error) {
	if l.MemoryMax <= 0 || l.MemoryMax > MemoryCeiling/2 || l.TasksMax <= 0 || l.TasksMax > TasksCeiling/2 || l.CPUQuotaPercent <= 0 || l.CPUQuotaPercent > CPUQuotaPercent/2 || l.RuntimeMax <= 0 || l.RuntimeMax > RuntimeCeiling/2 {
		return Limits{}, errors.New("invalid admission rollout limits")
	}
	return Limits{MemoryMax: l.MemoryMax, TasksMax: l.TasksMax, CPUQuotaPercent: l.CPUQuotaPercent, RuntimeMax: l.RuntimeMax}, nil
}

type AdmissionRunEvidence struct {
	RequestSHA256       string    `json:"requestSha256"`
	NativeSHA256        string    `json:"nativeSha256"`
	CoreSHA256          string    `json:"coreSha256"`
	Outcome             ErrorCode `json:"outcome"`
	MemoryPeakBytes     int64     `json:"memoryPeakBytes"`
	CPUMilliseconds     int64     `json:"cpuMilliseconds"`
	WallMilliseconds    int64     `json:"wallMilliseconds"`
	Cleaned             bool      `json:"cleaned"`
	TerminationEmpty    bool      `json:"terminationEmpty"`
	TerminationAbsent   bool      `json:"terminationAbsent"`
	ContainmentVerified bool      `json:"containmentVerified"`
}

type AdmissionP95 struct {
	MemoryPeakBytes  int64 `json:"memoryPeakBytes"`
	CPUMilliseconds  int64 `json:"cpuMilliseconds"`
	WallMilliseconds int64 `json:"wallMilliseconds"`
}

type AdmissionFirstRunEvidence struct {
	NativeSHA256 string          `json:"nativeSha256"`
	CoreSHA256   string          `json:"coreSha256"`
	Facts        []AdmissionFact `json:"facts"`
}

// AdmissionFact is assertion-ready without carrying raw document content.
type AdmissionFact struct {
	Kind             string `json:"kind"`
	FactPathSHA256   string `json:"factPathSha256"`
	CoordinateKind   string `json:"coordinateKind,omitempty"`
	ProducerSHA256   string `json:"producerSha256,omitempty"`
	StructuralSHA256 string `json:"structuralSha256"`
}

type AdmissionFixtureEvidence struct {
	ID                string                     `json:"id"`
	Format            Format                     `json:"format"`
	SourceSHA256      string                     `json:"sourceSha256"`
	PackageSHA256     string                     `json:"packageSha256"`
	RuntimeSHA256     string                     `json:"runtimeSha256"`
	CodeSHA256        string                     `json:"codeSha256"`
	BindingSHA256     string                     `json:"bindingSha256"`
	JobLimitsSHA256   string                     `json:"jobLimitsSha256"`
	First             *AdmissionFirstRunEvidence `json:"first"`
	Cold              []AdmissionRunEvidence     `json:"cold"`
	Warm              []AdmissionRunEvidence     `json:"warm"`
	P95               AdmissionP95               `json:"p95"`
	RolloutBudgetGate bool                       `json:"rolloutBudgetGate"`
}

type AdmissionHarnessReport struct {
	Kind     string                     `json:"kind"`
	Fixtures []AdmissionFixtureEvidence `json:"fixtures"`
}

func (r AdmissionHarnessReport) MarshalJSON() ([]byte, error) {
	if r.Kind != "anydoc-supervised-admission-v1" || len(r.Fixtures) == 0 {
		return nil, errors.New("invalid admission envelope")
	}
	for _, fixture := range r.Fixtures {
		if !validAdmissionProjectionEvidence(fixture) {
			return nil, errors.New("invalid admission projection evidence")
		}
	}
	type wireReport AdmissionHarnessReport
	encoded, err := json.Marshal(wireReport(r))
	if err != nil || len(encoded) > admissionEnvelopeMaxBytes {
		return nil, errors.New("admission envelope exceeds bound")
	}
	return encoded, nil
}

// RunAdmissionHarness runs one fresh supervisor unit at a time: three cold
// and five warm executions for every supplied applicable fixture.
func RunAdmissionHarness(ctx context.Context, supervisor *Supervisor, launch LaunchDependency, root string, fixtures []AdmissionFixtureCase, limits AdmissionHarnessLimits) (AdmissionHarnessReport, error) {
	serviceLimits, err := limits.supervisorLimits()
	if os.Getenv(admissionHarnessEnv) != "1" || err != nil || supervisor == nil || !filepath.IsAbs(root) || filepath.Clean(root) != root || len(fixtures) == 0 {
		return AdmissionHarnessReport{}, errors.New("invalid admission harness request")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return AdmissionHarnessReport{}, errors.New("admission harness workspace unavailable")
	}
	report := AdmissionHarnessReport{Kind: "anydoc-supervised-admission-v1", Fixtures: make([]AdmissionFixtureEvidence, 0, len(fixtures))}
	seen := make(map[string]struct{}, len(fixtures))
	for _, fixture := range fixtures {
		packageHash, codeHash, err := launchAdmissionHashes(launch)
		if err != nil {
			return AdmissionHarnessReport{}, err
		}
		if err := validAdmissionFixture(fixture, launch, packageHash, codeHash, seen); err != nil {
			return AdmissionHarnessReport{}, err
		}
		limitsDigest := jobLimitsDigest(jobLimits(serviceLimits))
		entry := AdmissionFixtureEvidence{ID: fixture.ID, Format: fixture.Format, SourceSHA256: fixture.SourceSHA256, PackageSHA256: packageHash, RuntimeSHA256: fixture.RuntimeSHA256, CodeSHA256: codeHash, BindingSHA256: admissionBindingDigest(fixture, limitsDigest), JobLimitsSHA256: limitsDigest}
		for runIndex := 0; runIndex < 8; runIndex++ {
			runEvidence, first, err := runAdmissionCase(ctx, supervisor, launch, root, fixture, serviceLimits)
			if err != nil {
				return AdmissionHarnessReport{}, err
			}
			if runIndex == 0 {
				entry.First = first
			} else if entry.First == nil || first.NativeSHA256 != entry.First.NativeSHA256 || first.CoreSHA256 != entry.First.CoreSHA256 {
				return AdmissionHarnessReport{}, errors.New("nondeterministic admission projection")
			}
			if runIndex < 3 {
				entry.Cold = append(entry.Cold, runEvidence)
			} else {
				entry.Warm = append(entry.Warm, runEvidence)
			}
		}
		if !validAdmissionProjectionEvidence(entry) {
			return AdmissionHarnessReport{}, errors.New("nondeterministic admission projection")
		}
		entry.P95 = admissionP95(append(append([]AdmissionRunEvidence(nil), entry.Cold...), entry.Warm...))
		entry.RolloutBudgetGate = withinAdmissionRolloutP95(entry.P95, jobLimits(serviceLimits))
		if !entry.RolloutBudgetGate {
			return AdmissionHarnessReport{}, errors.New("admission fixture exceeded rollout budget")
		}
		report.Fixtures = append(report.Fixtures, entry)
	}
	if _, err := report.MarshalJSON(); err != nil {
		return AdmissionHarnessReport{}, err
	}
	return report, nil
}

func validAdmissionFixture(fixture AdmissionFixtureCase, launch LaunchDependency, packageHash, codeHash string, seen map[string]struct{}) error {
	if fixture.ID == "" || len(fixture.ID) > 128 || strings.ContainsAny(fixture.ID, "/\\") || !admissionCandidateFormat(fixture.Format) || fixture.SourceSHA256 != sha256Hex(fixture.Bytes) || !validSHA256(fixture.SourceSHA256) || fixture.PackageSHA256 != packageHash || fixture.CodeSHA256 != codeHash || !validSHA256(fixture.RuntimeSHA256) || fixture.RuntimeSHA256 != launch.runtimeTreeDigest {
		return errors.New("invalid admission fixture binding")
	}
	if _, exists := seen[fixture.ID]; exists {
		return errors.New("duplicate admission fixture")
	}
	seen[fixture.ID] = struct{}{}
	return nil
}

func runAdmissionCase(ctx context.Context, supervisor *Supervisor, launch LaunchDependency, root string, fixture AdmissionFixtureCase, limits Limits) (AdmissionRunEvidence, *AdmissionFirstRunEvidence, error) {
	privateTemp, err := os.MkdirTemp(root, "run-")
	if err != nil {
		return AdmissionRunEvidence{}, nil, errors.New("admission run workspace unavailable")
	}
	defer os.RemoveAll(privateTemp)
	run, err := supervisor.startEvaluation(ctx, fixture.Bytes, fixture.Format, launch, privateTemp, limits)
	if err != nil {
		return AdmissionRunEvidence{}, nil, err
	}
	if err := run.Authorize(); err != nil {
		_ = run.Finish(context.Background(), err)
		return AdmissionRunEvidence{}, nil, err
	}
	result, executeErr := run.Execute(ctx)
	terminal := run.TerminalReport()
	evidence := AdmissionRunEvidence{RequestSHA256: run.digest, Outcome: terminal.Outcome, MemoryPeakBytes: terminal.PreStop.MemoryPeak, CPUMilliseconds: terminal.CPU.Milliseconds(), WallMilliseconds: terminal.Wall.Milliseconds(), Cleaned: terminal.Cleaned, TerminationEmpty: terminal.Termination.Empty, TerminationAbsent: terminal.Termination.Absent}
	evidence.ContainmentVerified = terminal.PreStop.ControlGroup != "" && terminal.Termination.ControlGroup == terminal.PreStop.ControlGroup && terminal.PreStop.MemoryPeak > 0 && terminal.Cleaned && (terminal.Termination.Empty != terminal.Termination.Absent)
	if executeErr != nil || !result.OK || result.SourceSHA256 != fixture.SourceSHA256 || result.Format != fixture.Format || terminal.PreStop.RuntimeTreeDigest != fixture.RuntimeSHA256 || !evidence.ContainmentVerified {
		return AdmissionRunEvidence{}, nil, errors.New("admission run failed rollout gate")
	}
	accounting, err := recomputePayloadAccounting(result.Request, result.Payload)
	if err != nil || result.Accounting == nil || accounting != *result.Accounting {
		return AdmissionRunEvidence{}, nil, errors.New("admission result accounting mismatch")
	}
	first, err := compactFirstRun(result.Payload)
	if err != nil {
		return AdmissionRunEvidence{}, nil, err
	}
	evidence.NativeSHA256 = first.NativeSHA256
	evidence.CoreSHA256 = first.CoreSHA256
	return evidence, first, nil
}

func validAdmissionProjectionEvidence(fixture AdmissionFixtureEvidence) bool {
	if fixture.First == nil || len(fixture.Cold) != 3 || len(fixture.Warm) != 5 || !validExactSHA256(fixture.First.NativeSHA256) || !validExactSHA256(fixture.First.CoreSHA256) {
		return false
	}
	allRuns := append(append([]AdmissionRunEvidence(nil), fixture.Cold...), fixture.Warm...)
	for _, run := range allRuns {
		if !validExactSHA256(run.NativeSHA256) || !validExactSHA256(run.CoreSHA256) || run.NativeSHA256 != fixture.First.NativeSHA256 || run.CoreSHA256 != fixture.First.CoreSHA256 {
			return false
		}
	}
	return true
}

func validExactSHA256(value string) bool {
	return validSHA256(value) && value == strings.ToLower(value)
}

func compactFirstRun(payload []byte) (*AdmissionFirstRunEvidence, error) {
	if len(payload) == 0 || len(payload) > MaxFrameBytes {
		return nil, errors.New("invalid admission result payload")
	}
	var envelope struct {
		Native json.RawMessage `json:"native"`
		Core   json.RawMessage `json:"core"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil || len(envelope.Native) == 0 || len(envelope.Core) == 0 {
		return nil, errors.New("invalid admission result projection")
	}
	var native struct {
		Facts []json.RawMessage `json:"facts"`
	}
	if err := json.Unmarshal(envelope.Native, &native); err != nil || len(native.Facts) > 4096 {
		return nil, errors.New("invalid native facts")
	}
	facts := make([]AdmissionFact, 0, len(native.Facts))
	for _, rawFact := range native.Facts {
		if len(rawFact) == 0 || len(rawFact) > MaxFrameBytes {
			return nil, errors.New("invalid compact fact")
		}
		var fact struct {
			Kind       string          `json:"kind"`
			FactPath   string          `json:"factPath"`
			Coordinate json.RawMessage `json:"coordinate"`
			Producer   json.RawMessage `json:"producer"`
		}
		if json.Unmarshal(rawFact, &fact) != nil {
			return nil, errors.New("invalid compact fact")
		}
		if fact.Kind == "" || len(fact.Kind) > 64 || fact.FactPath == "" {
			return nil, errors.New("invalid compact fact")
		}
		coordinateKind := ""
		if len(fact.Coordinate) != 0 {
			var coordinate struct {
				Kind string `json:"kind"`
			}
			if json.Unmarshal(fact.Coordinate, &coordinate) != nil || coordinate.Kind == "" {
				return nil, errors.New("invalid compact coordinate")
			}
			coordinateKind = coordinate.Kind
		}
		producerHash := ""
		if len(fact.Producer) != 0 {
			producerHash = sha256Hex(fact.Producer)
		}
		facts = append(facts, AdmissionFact{Kind: fact.Kind, FactPathSHA256: sha256Hex([]byte(fact.FactPath)), CoordinateKind: coordinateKind, ProducerSHA256: producerHash, StructuralSHA256: sha256Hex(rawFact)})
	}
	return &AdmissionFirstRunEvidence{NativeSHA256: sha256Hex(envelope.Native), CoreSHA256: sha256Hex(envelope.Core), Facts: facts}, nil
}

func launchAdmissionHashes(launch LaunchDependency) (string, string, error) {
	if launch.runtimeRunner != filepath.Join(launch.runtimeRoot, "runner.mjs") {
		return "", "", errors.New("invalid launch dependency")
	}
	packageBytes, packageErr := os.ReadFile(filepath.Join(launch.runtimeRoot, "node_modules", "@firecrawl", "anydoc", "package.json"))
	runnerBytes, runnerErr := os.ReadFile(launch.runtimeRunner)
	if packageErr != nil || runnerErr != nil {
		return "", "", errors.New("attested admission runtime unavailable")
	}
	return sha256Hex(packageBytes), sha256Hex(runnerBytes), nil
}

func admissionBindingDigest(fixture AdmissionFixtureCase, limitsDigest string) string {
	parts := []string{"crux-anydoc-admission-binding-v1", fixture.ID, string(fixture.Format), fixture.SourceSHA256, fixture.PackageSHA256, fixture.RuntimeSHA256, fixture.CodeSHA256, limitsDigest}
	return sha256Hex([]byte(strings.Join(parts, "\x00")))
}

func jobLimitsDigest(limits JobLimits) string {
	encoded, _ := json.Marshal(limits)
	return sha256Hex(encoded)
}

func admissionP95(samples []AdmissionRunEvidence) AdmissionP95 {
	if len(samples) != 8 {
		return AdmissionP95{}
	}
	memory := make([]int64, 0, len(samples))
	cpu := make([]int64, 0, len(samples))
	wall := make([]int64, 0, len(samples))
	for _, sample := range samples {
		memory = append(memory, sample.MemoryPeakBytes)
		cpu = append(cpu, sample.CPUMilliseconds)
		wall = append(wall, sample.WallMilliseconds)
	}
	return AdmissionP95{MemoryPeakBytes: nearestRankP95(memory), CPUMilliseconds: nearestRankP95(cpu), WallMilliseconds: nearestRankP95(wall)}
}

func nearestRankP95(values []int64) int64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	rank := (95*len(sorted) + 99) / 100
	return sorted[rank-1]
}

func withinAdmissionRolloutP95(p95 AdmissionP95, limits JobLimits) bool {
	return p95.MemoryPeakBytes > 0 && p95.MemoryPeakBytes <= limits.MemoryBytes/2 && p95.CPUMilliseconds >= 0 && p95.CPUMilliseconds <= limits.CPUMilliseconds/2 && p95.WallMilliseconds >= 0 && p95.WallMilliseconds <= limits.WallMilliseconds/2
}

func validSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
