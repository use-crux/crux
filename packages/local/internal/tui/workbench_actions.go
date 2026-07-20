package tui

import (
	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var navIDByGoKey = map[string]string{
	"o": "overview",
	"i": "insights",
	"r": "runs",
	"p": "index", // `g p` = project index
}

func browserBinding() key.Binding {
	return key.NewBinding(key.WithKeys("o"), key.WithHelp("o", "open browser"))
}

func (w *Workbench) handleKey(msg tea.KeyPressMsg) tea.Cmd {
	keyName := msg.String()

	// Overlays consume keys exclusively while open.
	if w.definitionChooser.IsOpen() {
		return w.definitionChooser.Update(msg)
	}
	if w.inspect.IsOpen() {
		return w.inspect.Update(msg)
	}
	if w.help.IsOpen() {
		return w.help.Update(msg)
	}
	if w.palette.IsOpen() {
		chosen, cmd := w.palette.Update(msg)
		if chosen.Verb != "" {
			return tea.Batch(cmd, w.runPaletteCommand(chosen))
		}
		return cmd
	}

	// Active editors and filters receive raw input before pane, workflow, or
	// workspace bindings. Overlays remain the more-specific scope.
	if editor, ok := w.activeScreen().(screens.EditingScreen); ok && editor.Editing() {
		return w.activeScreen().Update(w.ctx, msg, w.client)
	}

	// A prefix already claimed by the workspace owns its suffix before the
	// current workflow can interpret the same key.
	if w.pendingPrefix == "g" {
		w.pendingPrefix = ""
		if id, ok := navIDByGoKey[keyName]; ok {
			return w.gotoNav(id)
		}
		return nil
	}

	// Browser opening is a reserved workspace action. Editors and claimed
	// prefixes above still own text, but workflow actions cannot shadow `o`.
	if w.openBrowser != nil && key.Matches(msg, browserBinding()) {
		return w.browserAction().Run()
	}

	// Migrated screens list focused-pane actions before workflow actions.
	screen, migrated := w.activeScreen().(screens.ActionScreen)
	legacy, legacyAdapted := w.activeScreen().(screens.LegacyKeyScreen)
	if migrated {
		if cmd, handled := interaction.Dispatch(screen.Actions(w.ctx, w.client), msg); handled {
			return cmd
		}
	} else if legacyAdapted && legacy.HandlesKey(msg) {
		return w.activeScreen().Update(w.ctx, msg, w.client)
	}

	if cmd, handled := interaction.Dispatch(w.workspaceActions(), msg); handled {
		return cmd
	}
	if migrated || legacyAdapted {
		return nil
	}

	// Unmigrated screens retain their legacy key handler until their workflow
	// moves to ActionScreen in its planned phase.
	return w.activeScreen().Update(w.ctx, msg, w.client)
}

func (w *Workbench) workspaceActions() []interaction.Action {
	actions := make([]interaction.Action, 0, 5+len(w.navigationItems()))
	if len(w.history) > 0 {
		actions = append(actions, interaction.Action{
			ID:      "workspace.back",
			Binding: key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "back")),
			Run:     w.goBack,
		})
	}
	actions = append(actions,
		interaction.Action{
			ID:      "workspace.palette",
			Binding: key.NewBinding(key.WithKeys(":"), key.WithHelp(":", "command palette")),
			Run: func() tea.Cmd {
				w.palette.Open()
				return nil
			},
		},
		interaction.Action{
			ID:      "workspace.help",
			Binding: key.NewBinding(key.WithKeys("?"), key.WithHelp("?", "help")),
			Run: func() tea.Cmd {
				w.help.SetKeybinds(w.activeNav, actionKeybinds(w.workspaceActions()), w.screenKeybinds())
				w.help.Open()
				return nil
			},
		},
		interaction.Action{
			ID:      "workspace.jump-prefix",
			Binding: key.NewBinding(key.WithKeys("g"), key.WithHelp("g", "jump")),
			Run: func() tea.Cmd {
				w.pendingPrefix = "g"
				return nil
			},
		},
		interaction.Action{
			ID:      "workspace.quit",
			Binding: key.NewBinding(key.WithKeys("q"), key.WithHelp("q", "quit")),
			Run: func() tea.Cmd {
				if w.requestShutdown != nil {
					return w.requestShutdown()
				}
				return nil
			},
		},
	)
	if w.openBrowser != nil {
		actions = append(actions, w.browserAction())
	}
	for _, nav := range w.navigationItems() {
		nav := nav
		actions = append(actions, interaction.Action{
			ID:      "workspace.nav." + nav.ID,
			Binding: key.NewBinding(key.WithKeys(nav.Key), key.WithHelp(nav.Key, nav.Label)),
			Run:     func() tea.Cmd { return w.gotoNav(nav.ID) },
		})
	}
	return actions
}

func (w *Workbench) screenKeybinds() []shell.Keybind {
	if screen, ok := w.activeScreen().(screens.ActionScreen); ok {
		return actionKeybinds(screen.Actions(w.ctx, w.client))
	}
	return nil
}

func (w *Workbench) statusKeybinds() []shell.Keybind {
	if editor, ok := w.activeScreen().(screens.EditingScreen); ok && editor.Editing() {
		return w.screenKeybinds()
	}
	bindings := w.screenKeybinds()
	return append(bindings, actionKeybinds(w.workspaceActions())...)
}

func actionKeybinds(actions []interaction.Action) []shell.Keybind {
	bindings := interaction.Bindings(actions)
	help := make([]shell.Keybind, 0, len(bindings))
	for _, binding := range bindings {
		item := binding.Help()
		if item.Key == "" || item.Desc == "" {
			continue
		}
		help = append(help, shell.Bind(item.Key, item.Desc))
	}
	return help
}
