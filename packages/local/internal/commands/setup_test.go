package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestSetupCommandRoutesModesToWorker(t *testing.T) {
	old := runSetupOperationForCommand
	defer func() { runSetupOperationForCommand = old }()
	for _, tc := range []struct {
		name string
		args []string
		mode string
	}{
		{"default check", nil, "check"},
		{"explicit check", []string{"--check"}, "check"},
		{"apply", []string{"--apply"}, "apply"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
			runSetupOperationForCommand = func(_ context.Context, _, mode string, process commandWorkerProcess) (json.RawMessage, error) {
				if process.stderr != streams.Err {
					t.Fatal("setup worker stderr did not use the factory IO")
				}
				if mode != tc.mode {
					t.Fatalf("mode = %q", mode)
				}
				return json.RawMessage(`{"ok":true,"setup":{"ok":true,"mode":"` + mode + `","findings":[],"actions":[],"applied":[]},"generation":{"status":"current","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pendingFiles":[],"changedFiles":[],"findings":[]}}`), nil
			}
			cmd := NewSetupCmd(cli.NewFactoryWithStreams(streams))
			cmd.SetArgs(append([]string{"--json"}, tc.args...))
			if err := cmd.Execute(); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out.String(), `"mode": "`+tc.mode+`"`) {
				t.Fatalf("setup JSON did not use factory output: %q", out.String())
			}
		})
	}
}

func TestSetupHumanOutputGroupsContributorsAndShowsRemediation(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{ColorEnabled: false})
	report := setupCommandResult{
		OK:         false,
		Setup:      setupReport{OK: false, Mode: "check", Actions: []setupAction{}, Applied: []setupApplied{}},
		Generation: setupGeneration{Status: "blocked", PendingFiles: []string{}, ChangedFiles: []string{}, Findings: []eventwire.RuntimeArtifactFinding{}},
	}
	report.Setup.Findings = append(report.Setup.Findings,
		setupFinding{
			ContributorID: "runtime",
			Code:          "TABLE_MISSING",
			Resource:      "work",
			Message:       "Runtime table is missing.",
			Remediation:   "crux setup --apply",
		},
		setupFinding{
			ContributorID: "defer",
			Code:          "DEFER_NEXT_INTEGRATION_MISSING",
			Resource:      "@use-crux/next",
			Message:       "Next integration is missing.",
		},
	)

	if err := printSetupResult(streams, report); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	for _, expected := range []string{
		"runtime\n",
		"defer\n",
		"TABLE_MISSING work: Runtime table is missing.",
		"fix: crux setup --apply",
		"Setup needs attention",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("output missing %q:\n%s", expected, text)
		}
	}
}

func TestSetupReturnsExitOneAfterWritingAnUnhealthyReport(t *testing.T) {
	old := runSetupOperationForCommand
	defer func() { runSetupOperationForCommand = old }()
	runSetupOperationForCommand = func(context.Context, string, string, commandWorkerProcess) (json.RawMessage, error) {
		return json.RawMessage(`{"ok":false,"setup":{"ok":false,"mode":"check","findings":[{"contributorId":"runtime","code":"TABLE_MISSING","resource":"work","severity":"error","message":"missing"}],"actions":[],"applied":[]},"generation":{"status":"blocked","pendingFiles":[],"changedFiles":[],"findings":[]}}`), nil
	}

	var out, errOut strings.Builder
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	cmd := NewSetupCmd(cli.NewFactoryWithStreams(streams))
	cmd.SetArgs([]string{"--json"})
	err := cmd.Execute()
	var exitErr domain.ExitError
	if !errors.As(err, &exitErr) || exitErr.Code != 1 {
		t.Fatalf("error = %v, want exit 1", err)
	}
	if !strings.Contains(out.String(), `"TABLE_MISSING"`) {
		t.Fatalf("report was not written before exit:\n%s", out.String())
	}
	if errOut.Len() != 0 {
		t.Fatalf("intentional setup exit wrote error noise:\n%s", errOut.String())
	}
}

func TestSetupRejectsCheckAndApply(t *testing.T) {
	cmd := NewSetupCmd(&cli.Factory{})
	cmd.SetArgs([]string{"--check", "--apply"})
	if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "at most one") {
		t.Fatalf("error = %v", err)
	}
}

func TestDecodeSetupCommandResultEnforcesStatusMatrixAndPaths(t *testing.T) {
	valid := `{"ok":false,"setup":{"ok":true,"mode":"check","findings":[{"contributorId":"runtime-artifacts","code":"RUNTIME_ARTIFACTS_STALE","resource":"generated-runtime-files","severity":"warning","message":"stale"}],"actions":[],"applied":[]},"generation":{"status":"would-generate","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pendingFiles":[".crux/generated/runtime/manifest.json"],"changedFiles":[],"findings":[]}}`
	if _, err := decodeSetupCommandResult(json.RawMessage(valid)); err != nil {
		t.Fatalf("valid result: %v", err)
	}

	for name, raw := range map[string]string{
		"unknown field":        strings.Replace(valid, `"ok":false`, `"ok":false,"future":true`, 1),
		"apply would-generate": strings.Replace(valid, `"mode":"check"`, `"mode":"apply"`, 1),
		"unsafe path":          strings.Replace(valid, `.crux/generated/runtime/manifest.json`, `..\\manifest.json`, 1),
		"missing arrays":       `{"ok":false,"setup":{"ok":false,"mode":"check","findings":[{"contributorId":"x","code":"X","resource":"x","severity":"error","message":"x"}],"actions":[],"applied":[]},"generation":{"status":"blocked"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeSetupCommandResult(json.RawMessage(raw)); err == nil {
				t.Fatalf("decode succeeded for malformed result: %s", raw)
			}
		})
	}
}

func TestSetupHumanOutputRendersGenerationFindingsWithoutJSON(t *testing.T) {
	var out, errOut strings.Builder
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	result := setupCommandResult{
		OK: false,
		Setup: setupReport{
			OK: false, Mode: "apply", Actions: []setupAction{}, Applied: []setupApplied{},
			Findings: []setupFinding{{ContributorID: "runtime-artifacts", Code: "RUNTIME_ARTIFACT_GENERATION_FAILED", Resource: "generated-runtime-files", Severity: "error", Message: "Runtime files could not be prepared."}},
		},
		Generation: setupGeneration{
			Status: "failed", PendingFiles: []string{}, ChangedFiles: []string{},
			Findings: []eventwire.RuntimeArtifactFinding{{Code: "TARGET_NOT_EXPORTED", Category: "authored", Summary: "Target review is not exported.", Reason: "The named export is missing.", Remediation: "Export review and save the file."}},
		},
	}

	if err := printSetupResult(streams, result); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	for _, want := range []string{"Runtime files could not be prepared (1 issue)", "Target review is not exported", "Why: The named export is missing", "Fix: Export review"} {
		if !strings.Contains(text, want) {
			t.Fatalf("output missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, `"findings"`) {
		t.Fatalf("human output exposed JSON:\n%s", text)
	}
}

func TestSetupAppliesThenIndexesBeforeFinalGeneration(t *testing.T) {
	report := json.RawMessage(`{"ok":true,"mode":"apply","findings":[],"actions":[],"applied":[]}`)
	worker := &recordingSetupOperationWorker{planning: report}
	root := t.TempDir()

	if _, err := runSetupOperationWithPreparedWorker(context.Background(), root, "apply", worker); err != nil {
		t.Fatal(err)
	}
	if got, want := strings.Join(worker.order, ","), "setup,index,generation"; got != want {
		t.Fatalf("order = %q, want %q", got, want)
	}
	if string(worker.finalReport) != string(report) || len(worker.finalDefinitions) != 1 || worker.finalDefinitions[0].ID != "flow:fresh" {
		t.Fatalf("final input report=%s definitions=%#v", worker.finalReport, worker.finalDefinitions)
	}
	if len(worker.finalFindings) != 0 {
		t.Fatalf("generation findings = %#v, want none", worker.finalFindings)
	}
}

func TestSetupCheckDoesNotWriteProjectIndexCache(t *testing.T) {
	worker := &recordingSetupOperationWorker{
		planning: json.RawMessage(`{"ok":true,"mode":"check","findings":[],"actions":[],"applied":[]}`),
	}
	root := t.TempDir()

	if _, err := runSetupOperationWithPreparedWorker(context.Background(), root, "check", worker); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(root, ".crux", "cache")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("setup --check cache stat error = %v, want no cache writes", err)
	}
	if !worker.cacheDisabled {
		t.Fatal("setup --check did not disable caches for the indexing pipeline")
	}
}

func TestSetupTurnsFreshIndexFailureIntoGenerationFinding(t *testing.T) {
	worker := &recordingSetupOperationWorker{
		planning: json.RawMessage(`{"ok":true,"mode":"check","findings":[],"actions":[],"applied":[]}`),
		indexErr: errors.New("private compiler detail"),
	}

	root := t.TempDir()
	if _, err := runSetupOperationWithPreparedWorker(context.Background(), root, "check", worker); err != nil {
		t.Fatal(err)
	}
	if got, want := strings.Join(worker.order, ","), "setup,index,generation"; got != want {
		t.Fatalf("order = %q, want %q", got, want)
	}
	if len(worker.finalDefinitions) != 0 || len(worker.finalFindings) != 1 {
		t.Fatalf("definitions=%#v findings=%#v", worker.finalDefinitions, worker.finalFindings)
	}
	finding := worker.finalFindings[0]
	if finding.Code != "PROJECT_INDEX_FAILED" || finding.Category != "internal" || strings.Contains(finding.Reason, "private compiler detail") || finding.Remediation != "" {
		t.Fatalf("finding = %#v, want non-blaming internal index failure", finding)
	}
	if _, err := os.Stat(filepath.Join(root, ".crux", "cache")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("setup --check cache stat error = %v, want no cache writes", err)
	}
}

type recordingSetupOperationWorker struct {
	planning         json.RawMessage
	indexErr         error
	order            []string
	finalReport      json.RawMessage
	finalDefinitions []store.ProjectDefinition
	finalFindings    []eventwire.RuntimeArtifactFinding
	cacheDisabled    bool
}

func (w *recordingSetupOperationWorker) RunSetupPlanningOperation(context.Context, string, string) (json.RawMessage, error) {
	w.order = append(w.order, "setup")
	return w.planning, nil
}

func (w *recordingSetupOperationWorker) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (projectindex.IndexPatch, error) {
	result, err := w.IndexProjectAstPatchWithResult(ctx, root, configPath, projectName)
	return result.Patch, err
}

func (w *recordingSetupOperationWorker) IndexProjectAstPatchWithResult(ctx context.Context, root, _ string, _ string) (projectindex.ProjectAstIndexResult, error) {
	w.order = append(w.order, "index")
	w.cacheDisabled = projectindex.CacheDisabled(ctx)
	if w.indexErr != nil {
		return projectindex.ProjectAstIndexResult{}, w.indexErr
	}
	return projectindex.ProjectAstIndexResult{Patch: projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: root},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{Definitions: []store.ProjectDefinition{{
			ID: "flow:fresh", Kind: "flow", Name: "fresh",
		}}},
	}}, nil
}

func (w *recordingSetupOperationWorker) RunSetupOperation(_ context.Context, _ string, _ string, setupReport json.RawMessage, definitions []store.ProjectDefinition, findings []eventwire.RuntimeArtifactFinding) (json.RawMessage, error) {
	w.order = append(w.order, "generation")
	w.finalReport = append(json.RawMessage(nil), setupReport...)
	w.finalDefinitions = append([]store.ProjectDefinition(nil), definitions...)
	w.finalFindings = append([]eventwire.RuntimeArtifactFinding(nil), findings...)
	return json.RawMessage(`{"ok":true}`), nil
}
