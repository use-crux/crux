package indexhost

import "context"

type projectStaticSyntaxPlanKey struct {
	root        string
	configPath  string
	projectName string
}

type projectStaticSyntaxPlanCall struct {
	key     projectStaticSyntaxPlanKey
	done    chan struct{}
	result  projectStaticSyntaxPlanResult
	err     error
	waiters int
}

func (w *Worker) sharedProjectStaticSyntaxPlan(
	ctx context.Context,
	key projectStaticSyntaxPlanKey,
	run func(context.Context) (projectStaticSyntaxPlanResult, error),
) (projectStaticSyntaxPlanResult, error) {
	if w == nil {
		return run(ctx)
	}
	w.planMu.Lock()
	if active := w.activePlan; active != nil && active.key == key {
		active.waiters++
		w.planMu.Unlock()
		select {
		case <-active.done:
			return active.result, active.err
		case <-ctx.Done():
			return projectStaticSyntaxPlanResult{}, ctx.Err()
		}
	}
	call := &projectStaticSyntaxPlanCall{
		key:  key,
		done: make(chan struct{}),
	}
	w.activePlan = call
	w.planMu.Unlock()

	call.result, call.err = run(ctx)
	close(call.done)

	w.planMu.Lock()
	if w.activePlan == call {
		w.activePlan = nil
	}
	w.planMu.Unlock()
	return call.result, call.err
}
