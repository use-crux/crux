package tui

import (
	"strings"
	"testing"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

type fakeLegacyHandledScreen struct {
	*fakeScreen
	handledKey string
}

type fakeResizableActionScreen struct {
	*fakeActionScreen
	size screens.Size
}

func (s *fakeResizableActionScreen) Resize(size screens.Size) {
	s.size = size
}

func (s *fakeLegacyHandledScreen) HandlesKey(msg tea.KeyPressMsg) bool {
	return msg.String() == s.handledKey
}

func TestWorkbenchFilteringHintsHideWorkspaceActions(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	w.activeNav = "runs"
	w.screens["runs"] = screens.NewRuns()

	w.Update(tea.KeyPressMsg(tea.Key{Text: "/", Code: '/'}))
	out := ansi.Strip(w.View())

	if strings.Contains(out, "q quit") {
		t.Fatalf("filtering status advertised workspace quit:\n%s", out)
	}
	if !strings.Contains(out, "esc apply") {
		t.Fatalf("filtering status omitted executable filter controls:\n%s", out)
	}
}

func TestWorkbenchRoutesPageNavigationToFocusedRunsListPane(t *testing.T) {
	client := newOverviewRunsProgramClient()
	w := newTestWorkbench(client, client, "http://localhost:4400")
	w.Resize(120, 30)
	w.activeNav = "runs"
	runs := w.screens["runs"].(*screens.Runs)
	load := runs.Init(w.ctx, client)
	if load == nil {
		t.Fatal("Runs did not schedule its list load")
	}
	runs.Update(w.ctx, load(), client)
	w.View()

	w.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})

	if got := runs.SelectedRunID(); got != secondSimilarRunID {
		t.Fatalf("page down through Workbench selected %q, want %q", got, secondSimilarRunID)
	}
}

func TestWorkbenchResizesActiveScreenBeforeActionInput(t *testing.T) {
	resizedBeforeRun := false
	screen := &fakeResizableActionScreen{fakeActionScreen: &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "runs"},
	}}
	screen.actions = []interaction.Action{{
		ID:      "resized-action",
		Binding: key.NewBinding(key.WithKeys("x")),
		Run: func() tea.Cmd {
			resizedBeforeRun = screen.size.Width > 0 && screen.size.Height > 0
			return nil
		},
	}}
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["runs"] = screen
	w.activeNav = "runs"
	w.Resize(120, 30)

	w.Update(tea.KeyPressMsg{Text: "x", Code: 'x'})

	if !resizedBeforeRun {
		t.Fatalf("action ran before active screen received body size: %+v", screen.size)
	}
}

func TestWorkbenchMigratedScreenDoesNotFallThroughToLegacyUpdate(t *testing.T) {
	screen := &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{
			{
				ID:      "execute",
				Binding: key.NewBinding(key.WithKeys("e")),
				Run:     func() tea.Cmd { return nil },
			},
		},
	}
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = screen

	w.Update(tea.KeyPressMsg(tea.Key{Text: "x", Code: 'x'}))

	if len(screen.updateMsgs) != 0 {
		t.Fatalf("migrated screen received legacy key updates: %v", screen.updateMsgs)
	}
}

func TestWorkbenchHelpDoesNotTreatLegacyHintsAsExecutableActions(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(160, 40)
	w.activeNav = "index"

	w.Update(tea.KeyPressMsg(tea.Key{Text: "?", Code: '?'}))
	out := ansi.Strip(w.View())

	if strings.Contains(out, "open in viewer") {
		t.Fatalf("help advertised a legacy no-op as executable:\n%s", out)
	}
}

func TestWorkbenchLegacyWorkflowPrecedesWorkspaceActions(t *testing.T) {
	screen := &fakeLegacyHandledScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		handledKey: "q",
	}
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = screen
	quitRequested := false
	w.setShutdownRequest(func() tea.Cmd {
		quitRequested = true
		return nil
	})

	w.Update(tea.KeyPressMsg(tea.Key{Text: "q", Code: 'q'}))

	if len(screen.updateMsgs) != 1 {
		t.Fatalf("legacy workflow updates = %d, want one", len(screen.updateMsgs))
	}
	if quitRequested {
		t.Fatal("workspace quit ran after legacy workflow consumed q")
	}
}

func TestWorkbenchClaimedPrefixResolvesBeforeWorkflowActions(t *testing.T) {
	workflowCalls := 0
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{
			{
				ID:      "workflow.inspect",
				Binding: key.NewBinding(key.WithKeys("i")),
				Run: func() tea.Cmd {
					workflowCalls++
					return nil
				},
			},
		},
	}

	w.Update(tea.KeyPressMsg(tea.Key{Text: "g", Code: 'g'}))
	w.Update(tea.KeyPressMsg(tea.Key{Text: "i", Code: 'i'}))

	if workflowCalls != 0 {
		t.Fatalf("workflow action ran %d times for claimed workspace prefix", workflowCalls)
	}
	if w.activeNav != "insights" {
		t.Fatalf("active nav = %q, want insights", w.activeNav)
	}
	if w.pendingPrefix != "" {
		t.Fatalf("pending prefix = %q, want cleared", w.pendingPrefix)
	}
}

func TestWorkbenchJumpPrefixShowsSuffixHintAndAcceptsNumericNav(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)

	w.Update(tea.KeyPressMsg(tea.Key{Text: "g", Code: 'g'}))
	view := ansi.Strip(w.View())
	if !strings.Contains(view, "g → o overview · i insights · r runs · e evals · p index") {
		t.Fatalf("pending jump omitted suffix hint:\n%s", view)
	}

	w.Update(tea.KeyPressMsg(tea.Key{Text: "2", Code: '2'}))
	if w.activeNav != "insights" {
		t.Fatalf("g2 active nav = %q, want insights", w.activeNav)
	}
	if w.pendingPrefix != "" {
		t.Fatalf("pending prefix = %q, want cleared", w.pendingPrefix)
	}
}

func TestWorkbenchJumpPrefixHintPrecedesStandingStartupBadge(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(70, 24)
	w.SetStartupSnapshot(startup.Snapshot{Diagnostics: []startup.Diagnostic{{
		ID: "setup", Code: "SETUP", Severity: "warning", Message: "setup issue",
	}}})

	w.Update(tea.KeyPressMsg(tea.Key{Text: "g", Code: 'g'}))
	view := ansi.Strip(w.View())
	if !strings.Contains(view, "g → o overview · i insights · r runs · e evals · p index") {
		t.Fatalf("standing startup badge hid pending jump hint:\n%s", view)
	}
}

func TestWorkbenchUnknownJumpSuffixFallsThroughToWorkflow(t *testing.T) {
	calls := 0
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{{
			ID:      "workflow.x",
			Binding: key.NewBinding(key.WithKeys("x")),
			Run: func() tea.Cmd {
				calls++
				return nil
			},
		}},
	}

	w.Update(tea.KeyPressMsg(tea.Key{Text: "g", Code: 'g'}))
	w.Update(tea.KeyPressMsg(tea.Key{Text: "x", Code: 'x'}))

	if calls != 1 {
		t.Fatalf("unknown jump suffix workflow calls = %d, want 1", calls)
	}
	if w.pendingPrefix != "" {
		t.Fatalf("pending prefix = %q, want cleared", w.pendingPrefix)
	}
}

func TestWorkbenchLegacyAdapterDropsUnclaimedKeys(t *testing.T) {
	screen := &fakeLegacyHandledScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		handledKey: "e",
	}
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = screen

	w.Update(tea.KeyPressMsg(tea.Key{Text: "x", Code: 'x'}))

	if len(screen.updateMsgs) != 0 {
		t.Fatalf("legacy workflow received unclaimed key updates: %v", screen.updateMsgs)
	}
}
