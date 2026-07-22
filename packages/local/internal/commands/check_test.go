package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCheckJSONV1IsDeterministicAndGatesSelectedFindings(t *testing.T) {
	index := checkFixtureIndex(t.TempDir())
	result := oneshot.Result{
		Index: index,
		Execution: oneshot.Execution{
			Status: "partial", Static: "ready", Semantic: "degraded", Cache: "hit",
		},
	}
	report, failures, err := buildCheckReport(result, checkOptions{
		projectID: "fixture", profile: "recommended", failOn: "warning",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(failures) != 1 || failures[0].ID != "lint:warning" || !report.Summary.GateFailed {
		t.Fatalf("failures/report = %#v/%#v", failures, report.Summary)
	}

	var first, second bytes.Buffer
	if err := output.NewTestIO(&first, &bytes.Buffer{}, output.TestIOOptions{}).WriteJSON(report); err != nil {
		t.Fatal(err)
	}
	if err := output.NewTestIO(&second, &bytes.Buffer{}, output.TestIOOptions{}).WriteJSON(report); err != nil {
		t.Fatal(err)
	}
	if first.String() != second.String() {
		t.Fatal("check JSON changed between identical encodes")
	}
	if strings.Count(strings.TrimSpace(first.String()), "\n{") != 0 {
		t.Fatalf("stdout contains more than one JSON value: %s", first.String())
	}
	var decoded map[string]any
	if err := json.Unmarshal(first.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["schemaVersion"] != float64(1) {
		t.Fatalf("schemaVersion = %#v", decoded["schemaVersion"])
	}
	if strings.Contains(first.String(), "suppressed") || strings.Contains(first.String(), "durationMs") || strings.Contains(first.String(), "indexedAt") {
		t.Fatalf("JSON contains suppressed or volatile fields: %s", first.String())
	}
}

func TestCheckSummaryAndGateIgnoreDisplayedSuppressedFindings(t *testing.T) {
	report, failures, err := buildCheckReport(oneshot.Result{Index: store.IndexData{
		LintFindings: []store.IndexLintFinding{{
			ID: "suppressed", Severity: "error", Profiles: []string{"recommended"}, Suppressed: true,
			SuppressedBy: &store.IndexLintSuppressedBy{
				Source: &store.SourceLoc{File: "src/workflow.ts", Line: 7}, Scope: "next-line",
			},
		}},
	}}, checkOptions{profile: "recommended", includeSuppressed: true, failOn: "error"})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Findings) != 1 {
		t.Fatalf("displayed findings = %+v, want retained suppressed row", report.Findings)
	}
	if len(failures) != 0 || report.Summary.GateFailed || report.Summary.Findings != 0 || report.Summary.Errors != 0 {
		t.Fatalf("failures/summary = %+v/%+v, want active-only summary and gate", failures, report.Summary)
	}
}

func TestRunCheckUsesExitZeroOneAndTwoContract(t *testing.T) {
	for _, tc := range []struct {
		name       string
		failOn     string
		run        projectIndexRunFunc
		wantCode   int
		wantStdout bool
	}{
		{
			name: "zero", failOn: "none", wantCode: 0, wantStdout: true,
			run: func(context.Context, oneshot.Options) (oneshot.Result, error) {
				return oneshot.Result{Index: checkFixtureIndex(t.TempDir()), Execution: oneshot.Execution{Status: "complete"}}, nil
			},
		},
		{
			name: "one", failOn: "warning", wantCode: 1, wantStdout: true,
			run: func(context.Context, oneshot.Options) (oneshot.Result, error) {
				return oneshot.Result{Index: checkFixtureIndex(t.TempDir()), Execution: oneshot.Execution{Status: "complete"}}, nil
			},
		},
		{
			name: "two", failOn: "error", wantCode: 2,
			run: func(context.Context, oneshot.Options) (oneshot.Result, error) {
				return oneshot.Result{}, errors.New("config failed")
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			io := output.NewTestIO(&stdout, &stderr, output.TestIOOptions{})
			err := runCheck(context.Background(), io, checkOptions{root: ".", profile: "recommended", failOn: tc.failOn, json: true}, tc.run)
			code := 0
			if err != nil {
				var exit domain.ExitError
				if !errors.As(err, &exit) {
					t.Fatalf("error = %v, want ExitError", err)
				}
				code = exit.Code
			}
			if code != tc.wantCode {
				t.Fatalf("exit = %d, want %d", code, tc.wantCode)
			}
			if (stdout.Len() > 0) != tc.wantStdout {
				t.Fatalf("stdout = %q", stdout.String())
			}
			if tc.wantCode == 2 && !strings.Contains(stderr.String(), "config failed") {
				t.Fatalf("stderr = %q", stderr.String())
			}
		})
	}
}

func TestDaemonCheckAndLintCompileFixtureFindingsMatchByteForByte(t *testing.T) {
	root := t.TempDir()
	daemon := devtools.NewService(store.NewStore(), nil).
		WithFactStore(commandNoCacheStore{}).
		WithProjectIndexer(commandParityIndexer{})
	t.Cleanup(daemon.Shutdown)
	daemonIndex, err := daemon.ReindexProjectWithOptions(
		context.Background(), root, "", "fixture",
		devtools.ProjectReindexOptions{Semantic: devtools.ProjectSemanticInline},
	)
	if err != nil {
		t.Fatal(err)
	}
	daemonFindings, err := selectLintFindings(
		mustProjectIndexAPI(t, daemonIndex).LintFindings,
		lintSelectionOptions{profile: "recommended"},
	)
	if err != nil {
		t.Fatal(err)
	}

	run := func(ctx context.Context, options oneshot.Options) (result oneshot.Result, err error) {
		return oneshot.New(commandParityIndexer{}, commandNoCacheStore{}).Run(ctx, options)
	}
	var checkOut, checkErr bytes.Buffer
	checkIO := output.NewTestIO(&checkOut, &checkErr, output.TestIOOptions{})
	if err := runCheck(context.Background(), checkIO, checkOptions{
		root: root, projectID: "fixture", profile: "recommended",
		failOn: "none", json: true,
	}, run); err != nil {
		t.Fatalf("check: %v\nstderr: %s", err, checkErr.String())
	}
	var check checkJSONV1
	if err := json.Unmarshal(checkOut.Bytes(), &check); err != nil {
		t.Fatal(err)
	}

	var lintOut, lintErr bytes.Buffer
	lintIO := output.NewTestIO(&lintOut, &lintErr, output.TestIOOptions{})
	if err := runLint(context.Background(), lintIO, lintOptions{
		root: root, projectID: "fixture", profile: "recommended",
		json: true,
	}, run); err != nil {
		t.Fatalf("lint: %v\nstderr: %s", err, lintErr.String())
	}
	var lintFindings []api.IndexLintFinding
	if err := json.Unmarshal(lintOut.Bytes(), &lintFindings); err != nil {
		t.Fatal(err)
	}

	want := mustJSON(t, daemonFindings)
	if got := mustJSON(t, lintFindings); !bytes.Equal(got, want) {
		t.Fatalf("lint findings differ\ndaemon=%s\nlint=%s", want, got)
	}
	if got := mustJSON(t, check.Findings); !bytes.Equal(got, want) {
		t.Fatalf("check findings differ\ndaemon=%s\ncheck=%s", want, got)
	}
}

type commandParityIndexer struct{}

func (commandParityIndexer) IndexProjectAstPatch(_ context.Context, root, configPath, projectName string) (projectindex.IndexPatch, error) {
	return commandParityPatch(root, configPath, projectName, projectindex.PhaseAST, projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "partial", Status: "active"}},
		Diagnostics: []store.IndexDiagnostic{{ID: "diagnostic:static", Severity: "info", Code: "static.partial", Message: "static evidence"}},
	}), nil
}

func (commandParityIndexer) IndexProjectSemanticPatch(_ context.Context, request projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	return commandParityPatch(request.Root, request.ConfigPath, request.ProjectName, projectindex.PhaseSemantic, projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved", Status: "active"}},
	}), nil
}

func (commandParityIndexer) IndexProjectLintPatch(_ context.Context, request projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	return commandParityPatch(request.Root, request.ConfigPath, request.ProjectName, projectindex.PhaseQuality, projectindex.IndexPatchFacts{
		LintFindings: []store.IndexLintFinding{
			{ID: "lint:visible", Severity: "warning", RuleID: "fixture.visible", Category: "fixture", Profiles: []string{"recommended"}},
			{ID: "lint:suppressed", Severity: "info", RuleID: "fixture.suppressed", Category: "fixture", Profiles: []string{"recommended"}, Suppressed: true},
		},
	}), nil
}

func commandParityPatch(root, configPath, projectName string, phase projectindex.IndexPatchPhase, facts projectindex.IndexPatchFacts) projectindex.IndexPatch {
	return projectindex.IndexPatch{SchemaVersion: 1, Phase: phase, Project: store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}, Status: "ok", FinishedAt: "2026-07-14T00:00:00Z", Facts: facts}
}

type commandNoCacheStore struct{}

func (commandNoCacheStore) LoadSnapshot(context.Context, string, string, time.Time) (store.IndexData, bool, error) {
	return store.IndexData{}, false, nil
}
func (commandNoCacheStore) CommitPhase(context.Context, projectindex.IndexFactTransaction) error {
	return nil
}
func (commandNoCacheStore) ProjectSnapshot(context.Context, string, string) (store.IndexData, bool, error) {
	return store.IndexData{}, false, nil
}

func checkFixtureIndex(root string) store.IndexData {
	return store.IndexData{
		Project:     &store.ProjectIdentity{Root: root, Name: "fixture"},
		Definitions: []store.ProjectDefinition{{ID: "prompt:writer"}, {ID: "tool:search"}},
		Relations:   []store.ProjectRelation{{ID: "uses"}},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:z", Severity: "error", Code: "z", Message: "z"},
			{ID: "diagnostic:a", Severity: "info", Code: "a", Message: "a"},
		},
		LintFindings: []store.IndexLintFinding{
			{ID: "lint:suppressed", Severity: "error", RuleID: "z", Category: "fixture", Profiles: []string{"recommended"}, Suppressed: true},
			{ID: "lint:warning", Severity: "warning", RuleID: "a", Category: "fixture", Profiles: []string{"recommended"}},
		},
	}
}

func mustProjectIndexAPI(t *testing.T, index store.IndexData) api.IndexData {
	t.Helper()
	value, err := projectIndexAPI(index)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
