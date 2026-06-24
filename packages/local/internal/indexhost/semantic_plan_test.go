package indexhost

import (
	"context"
	"encoding/json"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax"
)

func TestWorkerPlanProjectSemanticRequestUsesNativeStaticSourceProfile(t *testing.T) {
	root := t.TempDir()
	writeNativeStaticEnabledConfig(t, root)
	primary := writeNativeStaticPlanCacheFixtureFile(t, root, "src/writer.ts", "import './helper'\nexport const writer = prompt({ id: 'writer' })\n")
	helper := writeNativeStaticPlanCacheFixtureFile(t, root, "src/helper.ts", "export const helper = 'writer'\n")

	worker := newTestWorker(t).WithSyntaxParser(noopSyntaxParser{})
	defer worker.Close()

	request, err := worker.PlanProjectSemanticRequest(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("PlanProjectSemanticRequest error = %v", err)
	}
	if !slices.Contains(request.Files, primary) {
		t.Fatalf("semantic files = %v, want primary %s", request.Files, primary)
	}
	if slices.Contains(request.Files, helper) {
		t.Fatalf("semantic files = %v, want helper only in closure", request.Files)
	}
	for _, file := range []string{primary, helper} {
		if !slices.Contains(request.DependencyClosure, file) {
			t.Fatalf("dependency closure = %v, want %s", request.DependencyClosure, file)
		}
	}
	if request.SourceProfile == nil || !request.SourceProfile.Complete {
		t.Fatalf("source profile = %+v, want complete source profile", request.SourceProfile)
	}
	for _, file := range []string{primary, helper} {
		if !semanticProfileContainsFile(request.SourceProfile, file) {
			t.Fatalf("source profile = %+v, want %s", request.SourceProfile, file)
		}
	}
}

func TestWorkerSharesConcurrentStaticSyntaxPlan(t *testing.T) {
	worker := newTestWorker(t)
	defer worker.Close()

	key := projectStaticSyntaxPlanKey{
		root:        "/repo",
		configPath:  "crux.config.ts",
		projectName: "project",
	}
	started := make(chan struct{})
	release := make(chan struct{})
	var runs atomic.Int32
	result := projectStaticSyntaxPlanResult{
		Plan: projectindex.ProjectStaticSyntaxPlan{
			Root:        key.root,
			ProjectName: key.projectName,
			Files:       []string{"/repo/src/writer.ts"},
		},
	}
	run := func(ctx context.Context) (projectStaticSyntaxPlanResult, error) {
		if runs.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
			return result, nil
		case <-ctx.Done():
			return projectStaticSyntaxPlanResult{}, ctx.Err()
		}
	}

	first := make(chan projectStaticSyntaxPlanResult, 1)
	second := make(chan projectStaticSyntaxPlanResult, 1)
	go func() {
		planned, err := worker.sharedProjectStaticSyntaxPlan(context.Background(), key, run)
		if err != nil {
			t.Errorf("first sharedProjectStaticSyntaxPlan error = %v", err)
		}
		first <- planned
	}()
	<-started
	go func() {
		planned, err := worker.sharedProjectStaticSyntaxPlan(context.Background(), key, run)
		if err != nil {
			t.Errorf("second sharedProjectStaticSyntaxPlan error = %v", err)
		}
		second <- planned
	}()
	waitForStaticSyntaxPlanWaiter(t, worker)
	close(release)

	if planned := <-first; !slices.Equal(planned.Plan.Files, result.Plan.Files) {
		t.Fatalf("first plan files = %v, want %v", planned.Plan.Files, result.Plan.Files)
	}
	if planned := <-second; !slices.Equal(planned.Plan.Files, result.Plan.Files) {
		t.Fatalf("second plan files = %v, want %v", planned.Plan.Files, result.Plan.Files)
	}
	if runs.Load() != 1 {
		t.Fatalf("plan runs = %d, want one shared run", runs.Load())
	}
}

func waitForStaticSyntaxPlanWaiter(t testing.TB, worker *Worker) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		worker.planMu.Lock()
		waiters := 0
		if worker.activePlan != nil {
			waiters = worker.activePlan.waiters
		}
		worker.planMu.Unlock()
		if waiters > 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("timed out waiting for shared static syntax plan waiter")
}

type noopSyntaxParser struct{}

func (noopSyntaxParser) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func (noopSyntaxParser) Concurrency() int { return 1 }

func (noopSyntaxParser) Close() error { return nil }

func semanticProfileContainsFile(profile *projectindex.SemanticSourceProfile, file string) bool {
	if profile == nil {
		return false
	}
	for _, profileFile := range profile.Files {
		if profileFile.File == file {
			return true
		}
	}
	return false
}
