package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
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
	if err := writeCheckJSON(&first, report); err != nil {
		t.Fatal(err)
	}
	if err := writeCheckJSON(&second, report); err != nil {
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
	repoRoot, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(repoRoot, "packages", "indexer", "__tests__", "fixtures", "deployment-manifest-project")
	daemonIndexer := assets.NewEmbeddedProjectIndexer("")
	t.Cleanup(func() { _ = daemonIndexer.Close() })
	daemon := devtools.NewService(store.NewStore(), nil).WithProjectIndexer(daemonIndexer)
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
		lintSelectionOptions{profile: "recommended", includeSuppressed: true},
	)
	if err != nil {
		t.Fatal(err)
	}

	run := func(ctx context.Context, options oneshot.Options) (result oneshot.Result, err error) {
		indexer := assets.NewEmbeddedProjectIndexer("")
		defer func() {
			if closeErr := indexer.Close(); err == nil {
				err = closeErr
			}
		}()
		return oneshot.New(indexer, nil).Run(ctx, options)
	}
	var checkOut, checkErr bytes.Buffer
	checkIO := output.NewTestIO(&checkOut, &checkErr, output.TestIOOptions{})
	if err := runCheck(context.Background(), checkIO, checkOptions{
		root: root, projectID: "fixture", profile: "recommended",
		includeSuppressed: true, failOn: "none", json: true,
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
		includeSuppressed: true, json: true,
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
