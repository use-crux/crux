package bridge

import (
	"context"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

func TestSessionWaitJoinsCollectorsAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	session := Start(ctx, Sources{StoreChanged: make(chan struct{})}, func(tea.Msg) {})
	cancel()
	waitCtx, stopWaiting := context.WithTimeout(context.Background(), time.Second)
	defer stopWaiting()
	if err := session.Wait(waitCtx); err != nil {
		t.Fatalf("wait for bridge session: %v", err)
	}
}
