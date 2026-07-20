package screens

import (
	"errors"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

func TestIndexResourceErrorsAreTerminalSafeAndBounded(t *testing.T) {
	const hostileError = "worker \x1b]8;;https://evil.invalid\x07offline\x1b]8;;\x07\x00\r\t"
	assertSafeBounds := func(t *testing.T, view string, size Size) {
		t.Helper()
		for _, forbidden := range []string{"https://evil.invalid", "\x00", "\x07", "\r", "\t"} {
			if strings.Contains(view, forbidden) {
				t.Fatalf("resource error retained unsafe payload %q:\n%q", forbidden, view)
			}
		}
		lines := strings.Split(view, "\n")
		if len(lines) != size.Height {
			t.Fatalf("resource error lines = %d, want %d", len(lines), size.Height)
		}
		for lineIndex, line := range lines {
			if width := lipgloss.Width(line); width != size.Width {
				t.Fatalf("resource error line %d width = %d, want %d", lineIndex+1, width, size.Width)
			}
		}
	}

	size := Size{Width: 100, Height: 24}
	failedClient := newIndexResourceClient(api.IndexData{})
	failedClient.err = errors.New(hostileError)
	failed := NewIndex()
	failed.Resize(size)
	applyIndexCommand(t, failed, failed.Init(testContext, failedClient), failedClient)
	assertSafeBounds(t, failed.View(Size{}), size)

	degradedClient := newIndexResourceClient(sampleIndex())
	degraded := NewIndex()
	degraded.Resize(size)
	applyIndexCommand(t, degraded, degraded.Init(testContext, degradedClient), degradedClient)
	degradedClient.err = errors.New(hostileError)
	applyIndexCommand(t, degraded, degraded.Refresh(testContext, degradedClient, bridge.Invalidations{bridge.IndexSnapshotResource: 1}), degradedClient)
	degradedView := degraded.View(Size{})
	assertSafeBounds(t, degradedView, size)
	if !strings.Contains(stripANSI(degradedView), "degraded") {
		t.Fatalf("sanitized degraded state lost its semantic label:\n%s", stripANSI(degradedView))
	}
}
