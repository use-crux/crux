package kit

import (
	"math/rand"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func TestListPaneMovementKeepsSelectionVisible(t *testing.T) {
	t.Parallel()

	pane := NewListPane(func(item string) string { return item })
	pane.SetItems([]string{"a", "b", "c", "d", "e"})
	pane.SetSize(12, 3)
	pane.SetFocused(true)

	for range 3 {
		if handled := pane.Update(tea.KeyPressMsg{Text: "j", Code: 'j'}); !handled {
			t.Fatal("focused pane did not handle downward movement")
		}
	}

	selected, _, ok := pane.Selected()
	if !ok || selected != "d" {
		t.Fatalf("selection = (%q, %v), want d", selected, ok)
	}
	position := pane.Position()
	if position.Offset != 1 {
		t.Fatalf("offset = %d, want 1", position.Offset)
	}
	lines := pane.Render(func(item string, _ int, _ bool, _ int) string { return item })
	visible := false
	for _, line := range lines {
		visible = visible || strings.HasPrefix(line, "d")
	}
	if !visible {
		t.Fatalf("visible lines = %#v, want selected row d", lines)
	}
}

func TestListPanePageHomeEndStayWithinBounds(t *testing.T) {
	t.Parallel()

	pane := NewListPane(func(item string) string { return item })
	pane.SetItems(numberedItems(10))
	pane.SetSize(20, 3)
	pane.SetFocused(true)

	steps := []struct {
		key  tea.KeyPressMsg
		want int
	}{
		{key: tea.KeyPressMsg{Code: tea.KeyPgDown}, want: 3},
		{key: tea.KeyPressMsg{Code: tea.KeyEnd}, want: 9},
		{key: tea.KeyPressMsg{Code: tea.KeyPgDown}, want: 9},
		{key: tea.KeyPressMsg{Code: tea.KeyHome}, want: 0},
		{key: tea.KeyPressMsg{Code: tea.KeyPgUp}, want: 0},
	}
	for _, step := range steps {
		if handled := pane.Update(step.key); !handled {
			t.Fatalf("pane did not handle %q", step.key.String())
		}
		if got := pane.Position().SelectedIndex; got != step.want {
			t.Fatalf("after %q selected index = %d, want %d", step.key.String(), got, step.want)
		}
	}
}

func TestListPaneRefreshPreservesStableSelection(t *testing.T) {
	t.Parallel()

	type item struct {
		id    string
		label string
	}
	pane := NewListPane(func(item item) string { return item.id })
	pane.SetItems([]item{
		{id: "a", label: "before"},
		{id: "b", label: "before"},
		{id: "c", label: "before"},
	})
	if selected := pane.Select("b"); !selected {
		t.Fatal("pane did not select existing identity b")
	}

	pane.SetItems([]item{
		{id: "c", label: "after"},
		{id: "b", label: "after"},
		{id: "a", label: "after"},
	})

	selected, index, ok := pane.Selected()
	if !ok || selected.id != "b" || selected.label != "after" || index != 1 {
		t.Fatalf("selection = (%+v, %d, %v), want refreshed b at index 1", selected, index, ok)
	}
}

func TestListPaneRemovedSelectionChoosesDeterministicNeighbor(t *testing.T) {
	t.Parallel()

	pane := NewListPane(func(item string) string { return item })
	pane.SetItems([]string{"a", "b", "c", "d"})
	pane.Select("b")

	pane.SetItems([]string{"a", "c", "d"})

	selected, index, ok := pane.Selected()
	if !ok || selected != "c" || index != 1 {
		t.Fatalf("selection = (%q, %d, %v), want next neighbor c at index 1", selected, index, ok)
	}

	pane.Select("d")
	pane.SetItems([]string{"a", "c"})
	selected, index, ok = pane.Selected()
	if !ok || selected != "c" || index != 1 {
		t.Fatalf("clamped selection = (%q, %d, %v), want previous neighbor c at index 1", selected, index, ok)
	}
}

func TestListPaneRenderDoesNotRepairSelectionVisibility(t *testing.T) {
	type item struct {
		id     string
		height int
	}
	pane := NewListPane(func(item item) string { return item.id })
	pane.SetRowHeight(func(item item) int { return item.height })
	pane.SetItems([]item{
		{id: "a", height: 1},
		{id: "b", height: 1},
		{id: "c", height: 1},
		{id: "d", height: 1},
		{id: "e", height: 1},
	})
	pane.SetSize(12, 3)
	pane.Select("d")
	pane.SetItems([]item{
		{id: "a", height: 1},
		{id: "b", height: 3},
		{id: "c", height: 1},
		{id: "neighbor", height: 1},
		{id: "e", height: 1},
	})
	before := pane.Position()
	if before.Offset != 2 {
		t.Fatalf("SetItems left neighbor outside the visible budget: %+v", before)
	}

	pane.Render(func(item item, _ int, _ bool, _ int) string { return item.id })

	if after := pane.Position(); after != before {
		t.Fatalf("render mutated list position from %+v to %+v", before, after)
	}
}

func TestListPaneResizePreservesSelectionAndVisibleOffset(t *testing.T) {
	t.Parallel()

	pane := NewListPane(func(item string) string { return item })
	pane.SetRowHeight(func(string) int { return 2 })
	pane.SetItems(numberedItems(8))
	pane.SetSize(12, 4)
	pane.Select("item-05")

	pane.SetSize(20, 2)

	selected, index, ok := pane.Selected()
	if !ok || selected != "item-05" || index != 5 {
		t.Fatalf("selection = (%q, %d, %v), want item-05 at index 5", selected, index, ok)
	}
	if got := pane.Position().Offset; got != 5 {
		t.Fatalf("offset = %d, want selected row at top after one-row resize", got)
	}
}

func TestListPaneFocusGatesNavigation(t *testing.T) {
	t.Parallel()

	pane := NewListPane(func(item string) string { return item })
	pane.SetItems([]string{"a", "b"})
	down := tea.KeyPressMsg{Text: "j", Code: 'j'}

	if handled := pane.Update(down); handled {
		t.Fatal("unfocused pane handled navigation")
	}
	if got := pane.Position().SelectedIndex; got != 0 {
		t.Fatalf("unfocused selection index = %d, want 0", got)
	}

	pane.SetFocused(true)
	if handled := pane.Update(down); !handled {
		t.Fatal("focused pane did not handle navigation")
	}
	if got := pane.Position().SelectedIndex; got != 1 {
		t.Fatalf("focused selection index = %d, want 1", got)
	}

	pane.SetFocused(false)
	if handled := pane.Update(tea.KeyPressMsg{Text: "k", Code: 'k'}); handled {
		t.Fatal("pane handled navigation after losing focus")
	}
	if got := pane.Position().SelectedIndex; got != 1 {
		t.Fatalf("selection index after losing focus = %d, want 1", got)
	}
}

func TestListPaneMouseWheelFollowsFocus(t *testing.T) {
	t.Parallel()

	pane := NewListPane(func(item string) string { return item })
	pane.SetItems([]string{"a", "b", "c"})
	down := tea.MouseWheelMsg{Button: tea.MouseWheelDown}

	if handled := pane.Update(down); handled {
		t.Fatal("unfocused pane handled mouse wheel")
	}
	pane.SetFocused(true)
	if handled := pane.Update(down); !handled {
		t.Fatal("focused pane did not handle mouse wheel down")
	}
	selected, _, _ := pane.Selected()
	if selected != "b" {
		t.Fatalf("selection = %q, want b after wheel down", selected)
	}
	if handled := pane.Update(tea.MouseWheelMsg{Button: tea.MouseWheelUp}); !handled {
		t.Fatal("focused pane did not handle mouse wheel up")
	}
	selected, _, _ = pane.Selected()
	if selected != "a" {
		t.Fatalf("selection = %q, want a after wheel up", selected)
	}
}

func TestListPaneRestoresStableTopAnchorAfterReorder(t *testing.T) {
	pane := NewListPane(func(item string) string { return item })
	pane.SetItems([]string{"a", "b", "c", "d", "e"})
	pane.SetSize(20, 2)
	pane.SetFocused(true)
	pane.Select("d")
	anchor := pane.Anchor()
	if anchor == "" {
		t.Fatal("scrolled list did not expose a stable top anchor")
	}

	pane.SetItems([]string{"x", "a", "b", "c", "d", "e"})
	if !pane.RestoreAnchor(anchor) {
		t.Fatalf("failed to restore existing anchor %q", anchor)
	}
	if got := pane.Anchor(); got != anchor {
		t.Fatalf("restored top anchor = %q, want %q", got, anchor)
	}
}

func TestListPaneProperties(t *testing.T) {
	t.Parallel()

	rng := rand.New(rand.NewSource(23))
	keys := []tea.KeyPressMsg{
		{Text: "j", Code: 'j'},
		{Text: "k", Code: 'k'},
		{Code: tea.KeyPgDown},
		{Code: tea.KeyPgUp},
		{Code: tea.KeyHome},
		{Code: tea.KeyEnd},
	}
	for caseN := 0; caseN < 1_000; caseN++ {
		pane := NewListPane(func(item string) string { return item })
		pane.SetFocused(true)
		for step := 0; step < 80; step++ {
			switch rng.Intn(5) {
			case 0:
				pane.SetItems(numberedItems(rng.Intn(40)))
			case 1:
				pane.SetSize(rng.Intn(30), rng.Intn(12))
			case 2:
				pane.Update(keys[rng.Intn(len(keys))])
			case 3:
				pane.Update(tea.MouseWheelMsg{Button: tea.MouseWheelDown})
			default:
				pane.Update(tea.MouseWheelMsg{Button: tea.MouseWheelUp})
			}
			assertVListInvariants(t, &pane.list)
		}
	}
}
