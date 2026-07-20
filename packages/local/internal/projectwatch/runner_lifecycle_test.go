package projectwatch

import (
	"context"
	"testing"
	"time"
)

func TestRunnerWaitJoinsActiveHandler(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	runner := NewRunner(func(context.Context, Run) {
		close(started)
		<-release
	})
	runner.Enqueue(context.Background(), Delta{Files: []string{"prompt.ts"}})
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("runner handler did not start")
	}

	done := make(chan struct{})
	go func() {
		runner.Wait()
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("runner Wait returned before its handler")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runner Wait did not join its handler")
	}
}
