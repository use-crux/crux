package tui

import (
	"context"
	"errors"
	"strings"
	"testing"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
)

func TestWorkbenchShowsTypedStartupDiagnostic(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	w.SetStartupSnapshot(startup.Snapshot{Diagnostics: []startup.Diagnostic{{
		ID: "runtime-host-only", Code: "RUNTIME_HOST_ONLY", Severity: "warning",
		Message: "Runtime setup requires its configured host.", Remediation: "Generate the configured host handlers.",
	}}})

	view := ansi.Strip(w.View())
	if !strings.Contains(view, "⚠ 1 issue · ! details") ||
		strings.Contains(view, "RUNTIME_HOST_ONLY") ||
		strings.Contains(view, "Generate the configured") {
		t.Fatalf("startup diagnostic badge was not compact:\n%s", view)
	}
	w.Update(tea.KeyPressMsg(tea.Key{Text: "!", Code: '!'}))
	details := ansi.Strip(w.View())
	if !strings.Contains(details, "RUNTIME_HOST_ONLY") || !strings.Contains(details, "Generate the configured") {
		t.Fatalf("startup diagnostic details were not visible in the overlay:\n%s", details)
	}
}

func TestWorkbenchSummarizesAggregateStartupDiagnostic(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	w.SetStartupSnapshot(startup.Snapshot{Diagnostics: []startup.Diagnostic{{
		ID: "runtime-artifacts", Code: "RUNTIME_ARTIFACT_GENERATION_FAILED", Severity: "warning",
		Message: "3 issues · Eval answer is not ready.",
		Children: []startup.Diagnostic{
			{ID: "one", Code: "RUNTIME_EVAL_INVALID", Category: "authored", FeatureKind: "eval", FeatureID: "answer", Arm: "current", Source: "evals/answer.eval.ts", Message: "Eval answer is not ready.", Reason: "The task is not callable.", WhatStillWorks: "Other Evals still work.", Remediation: "Use a managed task.", Docs: "https://cruxjs.dev/docs/evals"},
			{ID: "two", Code: "TARGET_NOT_EXPORTED", Message: "Target review is not exported."},
			{ID: "three", Code: "ARTIFACTS_STALE", Message: "A generated path is occupied."},
		},
	}}})

	view := ansi.Strip(w.View())
	if !strings.Contains(view, "⚠ 3 issues · ! details") || strings.Contains(view, "Eval answer is not ready") {
		t.Fatalf("aggregate startup diagnostic was not summarized in workbench:\n%s", view)
	}

	w.Update(tea.KeyPressMsg(tea.Key{Text: "!", Code: '!'}))
	details := ansi.Strip(w.View())
	for _, want := range []string{"Runtime setup", "answer", "current", "evals/answer.eval.ts", "The task is not callable", "Other Evals still work", "Use a managed task", "https://cruxjs.dev/docs/evals"} {
		if !strings.Contains(details, want) {
			t.Fatalf("startup diagnostic details missing %q:\n%s", want, details)
		}
	}
	if strings.Contains(details, `"findings"`) || strings.Contains(details, `"featureKind"`) {
		t.Fatalf("startup details exposed transport JSON instead of human copy:\n%s", details)
	}
}

func TestWorkbenchStartupDetailsWrapLongCopyWithoutLosingItsTail(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(70, 24)
	tail := "KEEP_THIS_REMEDIATION_TAIL"
	w.SetStartupSnapshot(startup.Snapshot{Diagnostics: []startup.Diagnostic{{
		ID: "runtime-artifacts", Code: "RUNTIME_ARTIFACT_GENERATION_FAILED", Severity: "warning",
		Message: "1 issue · Runtime target is not exported.",
		Children: []startup.Diagnostic{{
			ID: "one", Code: "TARGET_NOT_EXPORTED", Category: "authored", Message: "Runtime target is not exported.",
			Reason:      "The named export is missing from a deeply nested source module.",
			Remediation: strings.Repeat("Use the exported target from this module and save the source file. ", 5) + tail,
		}},
	}}})

	w.Update(tea.KeyPressMsg(tea.Key{Text: "!", Code: '!'}))
	_ = w.View()
	w.Update(tea.KeyPressMsg(tea.Key{Text: "G", Code: 'G'}))
	view := ansi.Strip(w.View())
	if !strings.Contains(view, tail) {
		t.Fatalf("wrapped startup details lost long remediation tail:\n%s", view)
	}
	for lineNumber, line := range strings.Split(w.View(), "\n") {
		if width := lipgloss.Width(line); width > 70 {
			t.Fatalf("line %d width = %d, want <= 70", lineNumber+1, width)
		}
	}
}

func TestWorkspaceOpenBrowserCallsInjectedCapabilityOnce(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	calls := 0
	w.SetBrowserOpener("http://localhost:4400?t=session", func(_ context.Context, url string) error {
		calls++
		if url != "http://localhost:4400?t=session" {
			t.Fatalf("browser URL = %q", url)
		}
		return nil
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	if cmd == nil {
		t.Fatal("workspace o did not return a browser command")
	}
	if calls != 0 {
		t.Fatalf("browser calls before command execution = %d", calls)
	}
	_ = w.Update(cmd())
	if calls != 1 {
		t.Fatalf("browser calls = %d, want 1", calls)
	}
}

func TestExplicitBrowserFailureTemporarilyPrecedesStartupBadge(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(100, 30)
	w.SetStartupSnapshot(startup.Snapshot{Diagnostics: []startup.Diagnostic{{
		ID: "setup", Code: "SETUP", Severity: "warning", Message: "setup issue",
	}}})

	expiry := w.handleBrowserResult(browserResultMsg{Status: "browser launch failed: launcher unavailable"})
	view := ansi.Strip(w.View())
	if !strings.Contains(view, "browser launch…") || strings.Contains(view, "⚠ 1 issue") {
		t.Fatalf("explicit browser failure did not precede startup badge:\n%s", view)
	}
	if expiry == nil {
		t.Fatal("browser status did not schedule transient expiry")
	}

	w.Update(browserStatusExpiredMsg{Status: w.browserStatus})
	view = ansi.Strip(w.View())
	if !strings.Contains(view, "⚠ 1 issue") || strings.Contains(view, "browser launch…") {
		t.Fatalf("startup badge did not return after transient expiry:\n%s", view)
	}
}

func TestWorkspaceOpenBrowserCannotBeShadowedByWorkflowAction(t *testing.T) {
	workflowCalls := 0
	browserCalls := 0
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{{
			ID:      "workflow.conflict",
			Binding: key.NewBinding(key.WithKeys("o")),
			Run: func() tea.Cmd {
				workflowCalls++
				return nil
			},
		}},
	}
	w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
		browserCalls++
		return nil
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	if cmd == nil {
		t.Fatal("workspace o did not return a browser command")
	}
	w.Update(cmd())

	if browserCalls != 1 || workflowCalls != 0 {
		t.Fatalf("browser calls = %d, workflow calls = %d; want 1, 0", browserCalls, workflowCalls)
	}
}

func TestWorkspaceOpenBrowserFailureIsVisibleAndNonFatal(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
		return errors.New("launcher unavailable")
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	if cmd == nil {
		t.Fatal("workspace o did not return a browser command")
	}
	w.Update(cmd())

	view := ansi.Strip(w.View())
	if !strings.Contains(view, "browser launch…") {
		t.Fatalf("browser failure was not visible:\n%s", view)
	}
}

func TestWorkspaceOpenBrowserFailureIsSafeAndBoundedAtMinimumWidth(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(70, 24)
	w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
		return errors.New("\x1b[31mlauncher\n" + strings.Repeat("界", 1000))
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	w.Update(cmd())
	view := w.View()
	plain := ansi.Strip(view)

	if strings.Contains(view, "\x1b[31mlauncher") || !strings.Contains(plain, "browser launch…") {
		t.Fatalf("browser failure was not safely visible:\n%q", plain)
	}
	if width := lipgloss.Width(w.browserStatus); width > 256 {
		t.Fatalf("stored browser status width = %d, want <= 256", width)
	}
	for lineNumber, line := range strings.Split(view, "\n") {
		if width := lipgloss.Width(line); width > 70 {
			t.Fatalf("line %d width = %d, want <= 70:\n%q", lineNumber+1, width, ansi.Strip(line))
		}
	}
}

func TestWorkspaceOpenBrowserYieldsToEditorAndClaimedPrefix(t *testing.T) {
	t.Run("Runs filter receives o", func(t *testing.T) {
		calls := 0
		w := newTestWorkbench(nil, nil, "http://localhost:4400")
		w.activeNav = "runs"
		w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
			calls++
			return nil
		})

		w.Update(tea.KeyPressMsg(tea.Key{Text: "/", Code: '/'}))
		w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))

		if calls != 0 {
			t.Fatalf("browser calls while filtering = %d", calls)
		}
	})

	t.Run("g o navigates Overview", func(t *testing.T) {
		calls := 0
		w := newTestWorkbench(nil, nil, "http://localhost:4400")
		w.activeNav = "runs"
		w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
			calls++
			return nil
		})

		w.Update(tea.KeyPressMsg(tea.Key{Text: "g", Code: 'g'}))
		w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))

		if calls != 0 {
			t.Fatalf("browser calls for g o = %d", calls)
		}
		if w.activeNav != "overview" {
			t.Fatalf("active nav = %q, want overview", w.activeNav)
		}
	})
}

func TestWorkspaceOpenBrowserIsHiddenWithoutCapability(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	for _, action := range w.workspaceActions() {
		if action.ID == "workspace.open-browser" {
			t.Fatal("workspace browser action exposed without an opener")
		}
	}
}
