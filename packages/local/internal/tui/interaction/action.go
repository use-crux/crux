// Package interaction provides executable keyboard actions shared by TUI
// dispatch and contextual help.
package interaction

import (
	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

// Action binds one semantic operation to one or more keys.
type Action struct {
	ID             string
	Binding        key.Binding
	Run            func() tea.Cmd
	DisabledReason string
}

// Enabled reports whether the action can be dispatched and advertised.
func (a Action) Enabled() bool {
	return a.Binding.Enabled() && a.Run != nil && a.DisabledReason == ""
}

// Dispatch runs the first enabled action matching msg.
func Dispatch(actions []Action, msg tea.KeyPressMsg) (tea.Cmd, bool) {
	for _, action := range actions {
		if action.Enabled() && key.Matches(msg, action.Binding) {
			return action.Run(), true
		}
	}
	return nil, false
}

// Bindings returns help bindings for executable actions only.
func Bindings(actions []Action) []key.Binding {
	bindings := make([]key.Binding, 0, len(actions))
	for _, action := range actions {
		if action.Enabled() {
			bindings = append(bindings, action.Binding)
		}
	}
	return bindings
}
