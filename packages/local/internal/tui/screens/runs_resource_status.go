package screens

import (
	"errors"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func resourceLifecycleStatus(state resource.ResourceState, refreshing bool, err error) string {
	if state == resource.ResourceDegraded {
		if err == nil {
			return "degraded"
		}
		if errors.Is(err, resource.ErrStaleRevision) {
			return "degraded · stale revision"
		}
		return "degraded · " + kit.SanitizeInline(err.Error())
	}
	if refreshing {
		return "refreshing"
	}
	return ""
}

func (s *Runs) spanDetailLifecycleStatus() string {
	if s.layout.mode == runsLayoutWide || s.focus != focusSpanDetail {
		return ""
	}
	snapshot := s.detailResource.Snapshot()
	return resourceLifecycleStatus(snapshot.State, snapshot.Refreshing, snapshot.Err)
}

func lifecycleStatusRow(status string, width int) string {
	return padRow(" "+shell.TextMuted.Render(truncateRunsInline(status, max(0, width-2))), width)
}
