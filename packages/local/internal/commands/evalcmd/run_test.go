package evalcmd

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	evalserver "github.com/use-crux/crux/packages/local/internal/server/eval"
)

func TestConsumeStreamPreservesBindingExitCodes(t *testing.T) {
	for _, test := range []struct {
		name string
		in   string
		want int
	}{
		{name: "pass", in: `{"type":"run:done","exitCode":0}` + "\n", want: 0},
		{name: "blocking failure", in: `{"type":"run:done","exitCode":1}` + "\n", want: 1},
		{name: "discovery", in: `{"type":"collect:done","evals":[],"errors":[{"message":"duplicate Eval id"}]}` + "\n", want: 2},
		{name: "admission", in: `{"type":"error","message":"offline evidence missing"}` + "\n", want: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			var out bytes.Buffer
			got, err := consumeStream(&out, strings.NewReader(test.in))
			if err != nil || got != test.want {
				t.Fatalf("consumeStream = (%d, %v), want (%d, nil)", got, err, test.want)
			}
		})
	}
}

func TestConsumeStreamAcceptsEventsLargerThanScannerDefault(t *testing.T) {
	input := `{"type":"run:done","exitCode":0,"padding":"` + strings.Repeat("x", 128*1024) + `"}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v), want (0, nil)", exitCode, err)
	}
}

func TestCoordinatorConfirmationContinuesTheExistingEventStream(t *testing.T) {
	input := `{"type":"cost:confirmation-required"}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	confirmations := 0

	exitCode, err := consumeStreamWithConfirmation(&out, strings.NewReader(input), func() error {
		confirmations++
		return nil
	})

	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStreamWithConfirmation = (%d, %v)", exitCode, err)
	}
	if confirmations != 1 {
		t.Fatalf("confirmation count = %d, want 1", confirmations)
	}
}

func TestEvalListStreamGolden(t *testing.T) {
	input := `{"type":"collect:done","evals":[{"id":"support","sourceKey":{"relativeFile":"evals/support.eval.ts"},"cases":[{},{}]}],"errors":[]}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	want, err := os.ReadFile(filepath.Join("testdata", "cli-goldens", "eval-list.golden"))
	if err != nil {
		t.Fatal(err)
	}
	if out.String() != string(want) {
		t.Fatalf("eval list golden mismatch\n--- want\n%s\n--- got\n%s", want, out.String())
	}
}

func TestEvalCoordinatorJSONIsOneDocumentWithEventsAndExitCode(t *testing.T) {
	input := `{"type":"collect:done","evals":[{"id":"support","sourceKey":{"relativeFile":"evals/support.eval.ts"},"cases":[{}]}],"errors":[]}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeJSONStreamWithConfirmation(&out, strings.NewReader(input), nil)
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeJSONStreamWithConfirmation = (%d, %v)", exitCode, err)
	}
	var payload struct {
		Events   []json.RawMessage `json:"events"`
		ExitCode int               `json:"exitCode"`
	}
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("JSON output is invalid: %v\n%s", err, out.String())
	}
	if payload.ExitCode != 0 || len(payload.Events) != 2 || !bytes.Contains(payload.Events[0], []byte(`"support"`)) {
		t.Fatalf("JSON payload = %#v", payload)
	}
}

func TestSuccessfulCLICollectionPublishesSharedCatalogCache(t *testing.T) {
	root := t.TempDir()
	raw := json.RawMessage(`{"type":"collect:done","evals":[{"id":"shared","future":true}],"errors":[]}`)
	cacheSuccessfulCatalog(root)(raw, coordinatorEvent{Type: "collect:done"})
	manifests, _, err := evalserver.LoadCatalogCache(root, time.Now())
	if err != nil || len(manifests) != 1 || string(manifests[0]) != `{"id":"shared","future":true}` {
		t.Fatalf("shared cache = %s, err = %v", manifests, err)
	}
}

func TestRunFlagValidationHappensBeforeWorkerStart(t *testing.T) {
	if err := validateRunOptions(runOptions{watch: true, plan: true}, false); err == nil {
		t.Fatal("--watch --plan should fail")
	}
	if err := validateRunOptions(runOptions{maxCost: -1}, true); err == nil {
		t.Fatal("negative --max-cost should fail")
	}
	if err := validateRunOptions(runOptions{variants: []string{"fast", "cheap"}}, false); err == nil {
		t.Fatal("multiple --variant values should fail before worker start")
	}
}

func TestEvalPlanAndRunRenderingExplainsReadinessEvidenceAndResults(t *testing.T) {
	input := `{"type":"eval:plan","evalId":"support","plan":{"hostReadiness":{"status":"verified","deploymentId":"prod","hostKind":"cloudflare"},"preflight":{"status":"ready"},"cost":{"admission":{"status":"admitted"},"knownMaximumUsd":0.02,"unknownActionCount":0},"cells":[{"caseId":"refund","variant":"current","trial":0,"action":{"kind":"reuse","reason":"exact_evidence"}}]}}` + "\n" +
		`{"type":"eval:done","evalId":"support","run":{"runId":"eval-run-1","status":"complete","passed":false,"cost":{"actualUsd":0.01},"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"failed","task":{"status":"reused","reason":"exact_evidence"},"scores":[{"status":"computed","reason":"deterministic_local","name":"helpful","value":0.4}],"assertions":{"ran":1,"notEvaluated":0,"outcomes":[{"status":"failed","message":"expected yes"}]},"metrics":{"durationMs":42,"costUsd":0.01},"runIds":["run-generation-1"]}]}}` + "\n" +
		`{"type":"run:done","exitCode":1,"runIds":["eval-run-1"]}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 1 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	for _, want := range []string{
		"host verified: cloudflare deployment prod",
		"reuse (exact_evidence)",
		"42ms", "$0.010000", "helpful=0.4", "assertions 0/1 passed",
		"expected yes", "run-generation-1",
	} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("output missing %q:\n%s", want, out.String())
		}
	}
}

func TestEvalRunRenderingUsesCanonicalScoreAndAssertionStatusAndKeepsTrialsDistinct(t *testing.T) {
	input := `{"type":"eval:done","evalId":"support","run":{"runId":"eval-run-1","status":"complete","passed":false,"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"reused","reason":"exact_evidence"},"scores":[{"status":"reused","reason":"managed_external_reused","name":"helpful","value":0.9,"work":{"status":"reused","reason":"exact_evidence","evidenceRef":"score-1","reservation":"released"}}],"assertions":{"ran":1,"notEvaluated":0,"outcomes":[{"status":"passed","message":"first"}]},"metrics":{"durationMs":10}},{"caseId":"refund","variant":"current","trial":1,"status":"failed","task":{"status":"executed","reason":"no_exact_evidence"},"scores":[{"status":"missing","reason":"dependency_failed","name":"helpful","message":"task failed","work":{"status":"not_called","reason":"dependency_failed","reservation":"released"}}],"assertions":{"ran":1,"notEvaluated":0,"outcomes":[{"status":"failed","message":"second trial failed"}]},"metrics":{"durationMs":11}}]}}` + "\n" +
		`{"type":"run:done","exitCode":1}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 1 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	for _, want := range []string{
		"refund/current/trial-1", "refund/current/trial-2", "helpful=0.9 [reused]",
		"helpful missing (dependency_failed: task failed)", "assertions 1/1 passed",
		"assertions 0/1 passed", "second trial failed",
	} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("output missing %q:\n%s", want, out.String())
		}
	}
}

func TestEvalPlanRenderingIncludesEveryManagedScorerAction(t *testing.T) {
	input := `{"type":"eval:plan","evalId":"support","plan":{"hostReadiness":{"status":"local","reason":"no_required_host_work"},"preflight":{"status":"ready"},"cost":{"admission":{"status":"admitted"},"knownMaximumUsd":0,"unknownActionCount":1},"cells":[{"caseId":"refund","variant":"current","trial":0,"action":{"kind":"reuse","reason":"exact_evidence"}}],"scorerActions":[{"actionId":"refund:current:0:helpful","dependency":"task:root","scorerName":"helpful","occurrence":"0","externalKind":"model","price":{"kind":"unknown"},"admission":"admitted","evidenceRead":"allow","kind":"after_task_output","reason":"output_dependency","reservation":{"kind":"reserved","reservationId":"reservation-1"}},{"actionId":"refund:current:0:safety","dependency":"task:root","scorerName":"safety","occurrence":"1","externalKind":"model","price":{"kind":"unknown"},"admission":"admitted","evidenceRead":"allow","kind":"reuse","reason":"exact_evidence","reservation":{"kind":"released"},"evidence":{"ref":"score-evidence-2"}}]}}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	for _, want := range []string{
		"scorer helpful: after_task_output (output_dependency)",
		"evidence allow", "reservation reserved", "price unknown",
		"scorer safety: reuse (exact_evidence)", "reservation released",
	} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("plan output missing %q:\n%s", want, out.String())
		}
	}
}

func TestEvalPlanExplainsUnattestedModelsOnce(t *testing.T) {
	input := `{"type":"eval:plan","evalId":"support","plan":{"hostReadiness":{"status":"local","reason":"no_required_host_work"},"preflight":{"status":"ready"},"cost":{"admission":{"status":"admitted"}},"cells":[{"caseId":"refund","variant":"current","trial":0,"action":{"kind":"execute","reason":"model_identity_unattested"}},{"caseId":"exchange","variant":"current","trial":0,"action":{"kind":"execute","reason":"model_identity_unattested"}}]}}` + "\n" +
		`{"type":"eval:done","evalId":"support","run":{"runId":"eval-run-1","status":"complete","passed":true,"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"executed","reason":"model_identity_unattested"},"metrics":{"durationMs":1}}]}}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	want := "reuse is disabled because this AI SDK model has no stable identity; wrap it with stableModel(model) from @use-crux/ai"
	if strings.Count(out.String(), want) != 1 {
		t.Fatalf("unattested model guidance count = %d, want 1:\n%s", strings.Count(out.String(), want), out.String())
	}
}

func TestEvalRunWithoutPlanExplainsUnattestedModelOnce(t *testing.T) {
	input := `{"type":"eval:done","evalId":"support","run":{"runId":"eval-run-1","status":"complete","passed":true,"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"executed","reason":"model_identity_unattested"},"metrics":{"durationMs":1}},{"caseId":"exchange","variant":"current","trial":0,"status":"passed","task":{"status":"executed","reason":"model_identity_unattested"},"metrics":{"durationMs":1}}]}}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	want := "wrap it with stableModel(model) from @use-crux/ai"
	if strings.Count(out.String(), want) != 1 {
		t.Fatalf("unattested model guidance count = %d, want 1:\n%s", strings.Count(out.String(), want), out.String())
	}
}

func TestEvalPlanExplainsUnresolvedSourceDependencyOnce(t *testing.T) {
	input := `{"type":"eval:plan","evalId":"support","plan":{"hostReadiness":{"status":"local","reason":"no_required_host_work"},"preflight":{"status":"ready"},"cost":{"admission":{"status":"admitted"}},"cells":[{"caseId":"refund","variant":"current","trial":0,"action":{"kind":"execute","reason":"unresolved_source_dependency"}},{"caseId":"exchange","variant":"current","trial":0,"action":{"kind":"execute","reason":"unresolved_source_dependency"}}]}}` + "\n" +
		`{"type":"eval:done","evalId":"support","run":{"runId":"eval-run-1","status":"complete","passed":true,"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"executed","reason":"unresolved_source_dependency"},"metrics":{"durationMs":1}}]}}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	want := "reuse is disabled because Crux could not prove the complete authored source dependency closure"
	if strings.Count(out.String(), want) != 1 {
		t.Fatalf("source dependency guidance count = %d, want 1:\n%s", strings.Count(out.String(), want), out.String())
	}
}

func TestEvalPlanExplainsUntrackedTaskBindingOnce(t *testing.T) {
	input := `{"type":"eval:plan","evalId":"support","plan":{"hostReadiness":{"status":"local","reason":"no_required_host_work"},"preflight":{"status":"ready"},"cost":{"admission":{"status":"admitted"}},"cells":[{"caseId":"refund","variant":"current","trial":0,"action":{"kind":"execute","reason":"task_binding_untracked"}},{"caseId":"exchange","variant":"current","trial":0,"action":{"kind":"execute","reason":"task_binding_untracked"}}]}}` + "\n" +
		`{"type":"eval:done","evalId":"support","run":{"runId":"eval-run-1","status":"complete","passed":true,"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"executed","reason":"task_binding_untracked"},"metrics":{"durationMs":1}}]}}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	want := "reuse is disabled because the managed task binding is not a literal ESM import; move generate.task() or stream.task() into a production module and import that task"
	if strings.Count(out.String(), want) != 1 {
		t.Fatalf("task binding guidance count = %d, want 1:\n%s", strings.Count(out.String(), want), out.String())
	}
}

func TestEvalPlanExplainsNondeterministicRenderer(t *testing.T) {
	input := `{"type":"eval:plan","evalId":"support","plan":{"hostReadiness":{"status":"local","reason":"no_required_host_work"},"preflight":{"status":"ready"},"cost":{"admission":{"status":"admitted"}},"cells":[{"caseId":"refund","variant":"current","trial":0,"action":{"kind":"execute","reason":"nondeterministic_renderer"}}]}}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	for _, want := range []string{"rendered differently for the same input", "Case input", "--fresh"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("renderer guidance missing %q:\n%s", want, out.String())
		}
	}
}
