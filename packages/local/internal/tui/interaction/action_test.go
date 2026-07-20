package interaction

import (
	"testing"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

func TestDispatchInvokesOnlyTheFirstMatchingAction(t *testing.T) {
	var invoked []string
	actions := []Action{
		{
			ID:      "first",
			Binding: key.NewBinding(key.WithKeys("x")),
			Run: func() tea.Cmd {
				invoked = append(invoked, "first")
				return nil
			},
		},
		{
			ID:      "second",
			Binding: key.NewBinding(key.WithKeys("x")),
			Run: func() tea.Cmd {
				invoked = append(invoked, "second")
				return nil
			},
		},
	}

	_, handled := Dispatch(actions, tea.KeyPressMsg(tea.Key{Text: "x", Code: 'x'}))
	if !handled {
		t.Fatal("matching action was not handled")
	}
	if len(invoked) != 1 || invoked[0] != "first" {
		t.Fatalf("invoked actions = %v, want only first", invoked)
	}
}

func TestBindingsIncludeOnlyExecutableActions(t *testing.T) {
	executable := key.NewBinding(key.WithKeys("e"), key.WithHelp("e", "execute"))
	noHandler := key.NewBinding(key.WithKeys("n"), key.WithHelp("n", "no-op"))
	disabled := key.NewBinding(key.WithKeys("d"), key.WithHelp("d", "disabled"))

	bindings := Bindings([]Action{
		{ID: "execute", Binding: executable, Run: func() tea.Cmd { return nil }},
		{ID: "no-handler", Binding: noHandler},
		{ID: "disabled", Binding: disabled, Run: func() tea.Cmd { return nil }, DisabledReason: "capability unavailable"},
	})

	if len(bindings) != 1 {
		t.Fatalf("help bindings = %d, want only executable action", len(bindings))
	}
	if got := bindings[0].Help().Desc; got != "execute" {
		t.Fatalf("help description = %q, want %q", got, "execute")
	}
}
