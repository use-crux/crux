package projectwatch

import "testing"

func TestDeltaAccumulatorChangedAfterDeletedWins(t *testing.T) {
	acc := newDeltaAccumulator()
	acc.addDeleted("/repo/src/a.ts")
	acc.addChanged("/repo/src/a.ts")

	delta := acc.delta()
	assertStrings(t, delta.Files, []string{"/repo/src/a.ts"})
	assertStrings(t, delta.DeletedFiles, nil)
}

func TestDeltaAccumulatorDeletedAfterChangedWins(t *testing.T) {
	acc := newDeltaAccumulator()
	acc.addChanged("/repo/src/a.ts")
	acc.addDeleted("/repo/src/a.ts")

	delta := acc.delta()
	assertStrings(t, delta.Files, nil)
	assertStrings(t, delta.DeletedFiles, []string{"/repo/src/a.ts"})
}

func TestMergeDeltaCoalescesAndSorts(t *testing.T) {
	delta := mergeDelta(
		Delta{Files: []string{"/repo/src/b.ts"}, DeletedFiles: []string{"/repo/src/old.ts"}},
		Delta{Files: []string{"/repo/src/a.ts", "/repo/src/old.ts"}, DeletedFiles: []string{"/repo/src/b.ts"}},
	)

	assertStrings(t, delta.Files, []string{"/repo/src/a.ts", "/repo/src/old.ts"})
	assertStrings(t, delta.DeletedFiles, []string{"/repo/src/b.ts"})
}

func TestQueueTransitionsRunOneDeltaAtATime(t *testing.T) {
	first := enqueueDelta(queueState{}, Delta{Files: []string{"/repo/src/a.ts"}})
	if first.action != queueActionStart {
		t.Fatalf("first action = %s, want start", first.action)
	}
	if first.run.ID != 1 {
		t.Fatalf("first run ID = %d, want 1", first.run.ID)
	}

	second := enqueueDelta(first.state, Delta{Files: []string{"/repo/src/b.ts"}})
	if second.action != queueActionIdle {
		t.Fatalf("second action = %s, want idle", second.action)
	}
	assertStrings(t, second.state.pending.delta.Files, []string{"/repo/src/b.ts"})

	third := enqueueDelta(second.state, Delta{Files: []string{"/repo/src/c.ts"}})
	if third.action != queueActionIdle {
		t.Fatalf("third action = %s, want idle", third.action)
	}
	assertStrings(t, third.state.pending.delta.Files, []string{"/repo/src/b.ts", "/repo/src/c.ts"})
	if third.state.pending.queue.DeltaBatchCount != 2 || !third.state.pending.queue.CoalescedWhileRunning {
		t.Fatalf("pending queue = %+v, want coalesced two-batch pending run", third.state.pending.queue)
	}
	if third.state.pending.queue.PendingRunReplacedCount != 1 {
		t.Fatalf("pending replaced count = %d, want 1", third.state.pending.queue.PendingRunReplacedCount)
	}

	next := completeRun(third.state)
	if next.action != queueActionContinue {
		t.Fatalf("complete action = %s, want continue", next.action)
	}
	if next.run.ID != 2 {
		t.Fatalf("next run ID = %d, want 2", next.run.ID)
	}
	assertStrings(t, next.run.Delta.Files, []string{"/repo/src/b.ts", "/repo/src/c.ts"})
	if next.run.Queue.DeltaBatchCount != 2 || !next.run.Queue.CoalescedWhileRunning {
		t.Fatalf("next run queue = %+v, want coalesced pending run", next.run.Queue)
	}

	done := completeRun(next.state)
	if done.action != queueActionIdle || done.state.running {
		t.Fatalf("done = %+v, want idle non-running state", done)
	}
}

func assertStrings(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("values = %v, want %v", actual, expected)
	}
	for i := range actual {
		if actual[i] != expected[i] {
			t.Fatalf("values = %v, want %v", actual, expected)
		}
	}
}
