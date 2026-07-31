package screens

import (
	"context"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func focusActionLabel(focus runsFocus) string {
	switch focus {
	case focusRuns:
		return "load run"
	case focusWaterfall:
		return "span detail"
	default:
		return "open"
	}
}

func (s *Runs) updateKey(ctx context.Context, msg tea.KeyPressMsg, client DataClient) tea.Cmd {
	if !s.filteringRuns && s.focus == focusRuns {
		if cmd, handled := s.updateRunListInput(ctx, msg, client); handled {
			return cmd
		}
	}
	if cmd, handled := interaction.Dispatch(s.Actions(ctx, client), msg); handled {
		return cmd
	}
	if s.filteringRuns {
		return s.updateRunFilter(ctx, msg, client)
	}
	return nil
}

// Actions returns the executable actions for the active Runs interaction
// scope. Filter controls replace workflow actions while filtering.
func (s *Runs) Actions(ctx context.Context, client DataClient) []interaction.Action {
	if s.filteringRuns {
		return s.filterActions(ctx, client)
	}

	inspectReason := ""
	if span := s.currentSpan(); span == nil || (s.currentActivity() == nil && len(span.Data) == 0) {
		inspectReason = "selected span has no raw payload"
	}
	exportReason := ""
	detailSnapshot := s.detailResource.Snapshot()
	selectedID := s.SelectedRunID()
	if !detailSnapshot.HasValue || selectedID == "" || detailSnapshot.Value.Run.RunID != selectedID {
		exportReason = "load a run before exporting"
	}
	definitionReason := disabledUnless(len(s.definitionChoices()) > 0, "no definition references")
	failureReason := disabledUnless(len(s.failingSpanIDs()) > 0, "run has no failing spans")
	payloadReason := disabledUnless(s.currentActivity() != nil && s.currentActivity().Primitive == "tool.call", "select a tool.call span")
	memberReason := disabledUnless(s.firstMemberRun() != nil, "run has no child members")
	triageReason := disabledUnless(s.diagnosis != nil && runStatusFailed(s.diagnosis.Summary.Status), "run is not failed")
	listFocusReason := disabledUnless(s.focus == focusRuns, "focus the run list")
	modelReason := listFocusReason
	if modelReason == "" {
		modelReason = disabledUnless(len(s.knownModels) > 0, "no models in the current page")
	}
	sessionReason := listFocusReason
	if sessionReason == "" && s.sessionFilter == "" {
		selected, _, ok := s.runList.Selected()
		sessionReason = disabledUnless(
			s.activeRunGroup().label == "session" &&
				ok &&
				selected.SessionID != "" &&
				s.sessions[selected.SessionID],
			"group by session and select a known session",
		)
	}
	activateReason := ""
	switch s.focus {
	case focusRuns:
		activateReason = disabledUnless(selectedID != "", "select a run to load")
	case focusWaterfall:
		activateReason = disabledUnless(s.currentSpan() != nil, "select a span to open")
	default:
		activateReason = "the detail pane has no open action"
	}
	pageDownKeys := []string{"pgdown"}
	pageDownHelp := "pgdn"
	pageUpKeys := []string{"pgup"}
	pageUpHelp := "pgup"
	firstKeys := []string{"home"}
	firstHelp := "home"
	lastKeys := []string{"end"}
	lastHelp := "end"
	if s.focus == focusSpanDetail {
		pageDownKeys = append(pageDownKeys, "ctrl+d")
		pageDownHelp = "pgdn/^d"
		pageUpKeys = append(pageUpKeys, "ctrl+u")
		pageUpHelp = "pgup/^u"
		firstKeys = append(firstKeys, "g")
		firstHelp = "home/g"
		lastKeys = append(lastKeys, "G")
		lastHelp = "end/G"
	}
	return []interaction.Action{
		{
			ID:      "runs.next",
			Binding: key.NewBinding(key.WithKeys("j", "down"), key.WithHelp("j/↓", "next "+s.focusItemLabel())),
			Run:     func() tea.Cmd { return s.moveDown(ctx, client) },
		},
		{
			ID:      "runs.previous",
			Binding: key.NewBinding(key.WithKeys("k", "up"), key.WithHelp("k/↑", "previous "+s.focusItemLabel())),
			Run:     func() tea.Cmd { return s.moveUp(ctx, client) },
		},
		{
			ID:      "runs.page-down",
			Binding: key.NewBinding(key.WithKeys(pageDownKeys...), key.WithHelp(pageDownHelp, "next "+s.focusPageLabel())),
			Run: func() tea.Cmd {
				cmd, _ := s.updateFocusedPaneInput(ctx, tea.KeyPressMsg{Code: tea.KeyPgDown}, client)
				return cmd
			},
		},
		{
			ID:      "runs.page-up",
			Binding: key.NewBinding(key.WithKeys(pageUpKeys...), key.WithHelp(pageUpHelp, "previous "+s.focusPageLabel())),
			Run: func() tea.Cmd {
				cmd, _ := s.updateFocusedPaneInput(ctx, tea.KeyPressMsg{Code: tea.KeyPgUp}, client)
				return cmd
			},
		},
		{
			ID:      "runs.first",
			Binding: key.NewBinding(key.WithKeys(firstKeys...), key.WithHelp(firstHelp, "first "+s.focusItemLabel())),
			Run: func() tea.Cmd {
				cmd, _ := s.updateFocusedPaneInput(ctx, tea.KeyPressMsg{Code: tea.KeyHome}, client)
				return cmd
			},
		},
		{
			ID:      "runs.last",
			Binding: key.NewBinding(key.WithKeys(lastKeys...), key.WithHelp(lastHelp, "last "+s.focusItemLabel())),
			Run: func() tea.Cmd {
				cmd, _ := s.updateFocusedPaneInput(ctx, tea.KeyPressMsg{Code: tea.KeyEnd}, client)
				return cmd
			},
		},
		{
			ID:      "runs.previous-pane",
			Binding: key.NewBinding(key.WithKeys("h", "left"), key.WithHelp("h/←", "previous pane")),
			Run: func() tea.Cmd {
				s.shiftFocus(-1)
				return nil
			},
		},
		{
			ID:      "runs.next-pane",
			Binding: key.NewBinding(key.WithKeys("l", "right"), key.WithHelp("l/→", "next pane")),
			Run: func() tea.Cmd {
				s.shiftFocus(1)
				return nil
			},
		},
		{
			ID:             "runs.activate",
			Binding:        key.NewBinding(key.WithKeys("enter"), key.WithHelp("↵", focusActionLabel(s.focus))),
			DisabledReason: activateReason,
			Run:            func() tea.Cmd { return s.activateFocus(ctx, client) },
		},
		{
			ID:             "runs.filter",
			Binding:        key.NewBinding(key.WithKeys("/"), key.WithHelp("/", "filter runs")),
			DisabledReason: disabledUnless(s.focus == focusRuns, "focus the run list to filter"),
			Run: func() tea.Cmd {
				s.filteringRuns = true
				return nil
			},
		},
		{
			ID:             "runs.status-filter",
			Binding:        key.NewBinding(key.WithKeys("f"), key.WithHelp("f", "status: "+s.activeRunStatusFilter().label)),
			DisabledReason: listFocusReason,
			Run:            func() tea.Cmd { return s.cycleRunStatusFilter(ctx, client) },
		},
		{
			ID:             "runs.window-filter",
			Binding:        key.NewBinding(key.WithKeys("w"), key.WithHelp("w", "window: "+s.activeRunWindow().label)),
			DisabledReason: listFocusReason,
			Run:            func() tea.Cmd { return s.cycleRunWindow(ctx, client) },
		},
		{
			ID:             "runs.group",
			Binding:        key.NewBinding(key.WithKeys("G"), key.WithHelp("G", "group: "+s.activeRunGroup().label)),
			DisabledReason: listFocusReason,
			Run:            func() tea.Cmd { return s.cycleRunGroup(ctx, client) },
		},
		{
			ID:             "runs.model-filter",
			Binding:        key.NewBinding(key.WithKeys("v"), key.WithHelp("v", "model: "+shortRunModel(firstNonEmpty(s.modelFilter, "all")))),
			DisabledReason: modelReason,
			Run:            func() tea.Cmd { return s.cycleRunModel(ctx, client) },
		},
		{
			ID:             "runs.session-filter",
			Binding:        key.NewBinding(key.WithKeys("s"), key.WithHelp("s", selectedSessionActionLabel(s.sessionFilter))),
			DisabledReason: sessionReason,
			Run:            func() tea.Cmd { return s.toggleSelectedSessionFilter(ctx, client) },
		},
		{
			ID:             "runs.failure-next",
			Binding:        key.NewBinding(key.WithKeys("e"), key.WithHelp("e", "next failure")),
			DisabledReason: failureReason,
			Run: func() tea.Cmd {
				s.stepFailure(1)
				return nil
			},
		},
		{
			ID:             "runs.failure-previous",
			Binding:        key.NewBinding(key.WithKeys("E"), key.WithHelp("E", "previous failure")),
			DisabledReason: failureReason,
			Run: func() tea.Cmd {
				s.stepFailure(-1)
				return nil
			},
		},
		{
			ID:             "runs.payload",
			Binding:        key.NewBinding(key.WithKeys("p"), key.WithHelp("p", "expand payload")),
			DisabledReason: payloadReason,
			Run: func() tea.Cmd {
				s.togglePayload()
				return nil
			},
		},
		{
			ID:             "runs.triage",
			Binding:        key.NewBinding(key.WithKeys("t"), key.WithHelp("t", "all/failure path")),
			DisabledReason: triageReason,
			Run: func() tea.Cmd {
				s.toggleTriageRows()
				return nil
			},
		},
		{
			ID:             "runs.member",
			Binding:        key.NewBinding(key.WithKeys("m"), key.WithHelp("m", "open child run")),
			DisabledReason: memberReason,
			Run:            func() tea.Cmd { return s.openFirstMember(ctx, client) },
		},
		{
			ID:             "runs.definition",
			Binding:        key.NewBinding(key.WithKeys("d"), key.WithHelp("d", "open definition")),
			DisabledReason: definitionReason,
			Run:            s.openDefinition,
		},
		{
			ID:             "runs.inspect",
			Binding:        key.NewBinding(key.WithKeys("i"), key.WithHelp("i", "inspect raw")),
			DisabledReason: inspectReason,
			Run:            s.openInspect,
		},
		{
			ID:             "runs.export",
			Binding:        key.NewBinding(key.WithKeys("x"), key.WithHelp("x", "export run")),
			DisabledReason: exportReason,
			Run:            s.exportRun,
		},
	}
}

func (s *Runs) filterActions(ctx context.Context, client DataClient) []interaction.Action {
	return []interaction.Action{
		{
			ID:      "runs.filter.finish",
			Binding: key.NewBinding(key.WithKeys("enter", "esc"), key.WithHelp("esc", "apply")),
			Run: func() tea.Cmd {
				s.filteringRuns = false
				return s.ensureFilteredRunSelection(ctx, client)
			},
		},
		{
			ID:             "runs.filter.clear",
			Binding:        key.NewBinding(key.WithKeys("ctrl+x"), key.WithHelp("^x", "clear")),
			DisabledReason: disabledUnless(s.runQuery != "", "filter is empty"),
			Run: func() tea.Cmd {
				s.runQuery = ""
				return s.ensureFilteredRunSelection(ctx, client)
			},
		},
		{
			ID:             "runs.filter.delete",
			Binding:        key.NewBinding(key.WithKeys("backspace"), key.WithHelp("⌫", "delete")),
			DisabledReason: disabledUnless(s.runQuery != "", "filter is empty"),
			Run: func() tea.Cmd {
				runes := []rune(s.runQuery)
				s.runQuery = string(runes[:len(runes)-1])
				return s.ensureFilteredRunSelection(ctx, client)
			},
		},
	}
}

func (s *Runs) Keybinds() []shell.Keybind {
	return actionKeybinds(s.Actions(context.TODO(), nil), nil)
}

func (s *Runs) waterfallKeybinds() []shell.Keybind {
	if s.focus != focusWaterfall {
		return nil
	}
	return actionKeybinds(s.Actions(context.TODO(), nil), map[string]bool{
		"runs.activate":         true,
		"runs.failure-next":     true,
		"runs.failure-previous": true,
		"runs.payload":          true,
		"runs.member":           true,
		"runs.inspect":          true,
		"runs.export":           true,
	})
}

func (s *Runs) togglePayload() {
	span := s.currentSpan()
	if span == nil {
		return
	}
	if s.expandedPayloads == nil {
		s.expandedPayloads = map[string]bool{}
	}
	s.expandedPayloads[span.ID] = !s.expandedPayloads[span.ID]
	s.resizeSpanDocument(s.layout.detail)
}

func (s *Runs) openFirstMember(ctx context.Context, client DataClient) tea.Cmd {
	member := s.firstMemberRun()
	if member == nil {
		return nil
	}
	detail := detailForMember(s.diagnosis.Raw.SchemaVersion, *member)
	s.ensureSelectedRunVisible(member.Run.RunID)
	s.runList.SetItems(s.selectableRuns())
	s.runList.Select(member.Run.RunID)
	s.spanList.SetItems(nil)
	s.diagnosis = nil
	s.showAllSpans = false
	_, token := s.detailResource.Begin(ctx, runsDetailOwner(member.Run.RunID), uint64Revision(member.Run.Revision))
	_ = s.applyRunDetail(ctx, resource.ResourceResult[api.ObservabilityRunDetail]{
		Token: token,
		Value: detail,
	}, client)
	return nil
}

func actionKeybinds(actions []interaction.Action, allowed map[string]bool) []shell.Keybind {
	bindings := make([]shell.Keybind, 0, len(actions))
	for _, action := range actions {
		if allowed != nil && !allowed[action.ID] {
			continue
		}
		if !action.Enabled() {
			continue
		}
		item := action.Binding.Help()
		if item.Key != "" && item.Desc != "" {
			bindings = append(bindings, shell.Bind(item.Key, item.Desc))
		}
	}
	return bindings
}

func (s *Runs) focusItemLabel() string {
	switch s.focus {
	case focusRuns:
		return "run"
	case focusSpanDetail:
		return "line"
	default:
		return "span"
	}
}

func (s *Runs) focusPageLabel() string {
	switch s.focus {
	case focusWaterfall:
		return "hierarchy page"
	case focusSpanDetail:
		return "detail page"
	default:
		return "run page"
	}
}

func disabledUnless(enabled bool, reason string) string {
	if enabled {
		return ""
	}
	return reason
}
