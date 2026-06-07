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

	second := enqueueDelta(first.state, Delta{Files: []string{"/repo/src/b.ts"}})
	if second.action != queueActionIdle {
		t.Fatalf("second action = %s, want idle", second.action)
	}
	assertStrings(t, second.state.pending.Files, []string{"/repo/src/b.ts"})

	next := completeRun(second.state)
	if next.action != queueActionContinue {
		t.Fatalf("complete action = %s, want continue", next.action)
	}
	assertStrings(t, next.delta.Files, []string{"/repo/src/b.ts"})

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
