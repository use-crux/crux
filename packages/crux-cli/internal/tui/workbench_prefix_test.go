package tui

import (
	"strings"
	"testing"

	"github.com/anthropics/crux-cli/internal/api"
)

// TestWorkbenchViewPrependsProjectTarget asserts that when the devtools
// context carries a project name and target id, the rendered breadcrumb
// begins with a `{project}:{target}` segment. This is how the workbench
// shows "where am I" now that the four-section tab strip is gone — see
// plans/tui-v1-quality-workbench-implementation.md S2.
func TestWorkbenchViewPrependsProjectTarget(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.devContext = api.DevtoolsContext{}
	w.devContext.Project.Name = "atlas"
	w.devContext.Target.ID = "docs_agent"
	w.Resize(120, 30)

	out := w.View()
	if !strings.Contains(out, "atlas:docs_agent") {
		t.Errorf("Workbench.View() does not contain expected workspace prefix %q\noutput head:\n%s",
			"atlas:docs_agent", head(out, 200))
	}
}

// TestWorkbenchViewOmitsPrefixWhenContextEmpty asserts the workbench does
// not render a stray `:` separator when project or target is missing.
func TestWorkbenchViewOmitsPrefixWhenContextEmpty(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	// devContext zero-value: no project, no target.
	w.Resize(120, 30)
	out := w.View()
	// A bare `:` segment would render around the colon; the breadcrumb
	// separator is ` / ` so a lone `:` between separators would look like
	// ` / : / `. Cheaper, more robust assertion: no `:` immediately
	// followed by ` /` on the first 80 chars.
	first := head(out, 80)
	if strings.Contains(first, " : ") || strings.HasPrefix(strings.TrimSpace(first), ":") {
		t.Errorf("Workbench.View() rendered stray prefix separator when context empty:\n%s", first)
	}
}

// TestWorkbenchBreadcrumbAbsorbsServerAndVersion asserts that the breadcrumb
// row's right-meta now carries what the tab strip used to: server URL,
// version. (Tab strip was dropped in S2.)
func TestWorkbenchBreadcrumbAbsorbsServerAndVersion(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4317")
	w.devContext = api.DevtoolsContext{}
	w.devContext.Version = "v0.14.2"
	w.Resize(160, 30)

	out := w.View()
	if !strings.Contains(out, "v0.14.2") {
		t.Errorf("Workbench.View() does not surface devContext.Version in breadcrumb right-meta")
	}
	if !strings.Contains(out, ":4317") {
		t.Errorf("Workbench.View() does not surface serverURL in breadcrumb right-meta")
	}
}

func head(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}
