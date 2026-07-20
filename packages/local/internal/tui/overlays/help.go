package overlays

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Help is the `?` keybinds overlay.
//
// The help renders two executable layers supplied by Workbench:
//
//   - workspace actions;
//   - focused screen actions.
type Help struct {
	open   bool
	filter string

	screenID       string
	workspaceBinds []shell.Keybind
	screenBinds    []shell.Keybind
}

// NewHelp constructs the help overlay.
func NewHelp() *Help { return &Help{} }

// Open shows the overlay.
func (h *Help) Open() { h.open = true; h.filter = "" }

// Close hides the overlay.
func (h *Help) Close() { h.open = false }

// IsOpen reports whether the overlay is shown.
func (h *Help) IsOpen() bool { return h.open }

// SetKeybinds replaces both help layers from the executable action registry.
func (h *Help) SetKeybinds(screenID string, workspace, screen []shell.Keybind) {
	h.screenID = screenID
	h.workspaceBinds = workspace
	h.screenBinds = screen
}

// SetScreenKeybinds replaces the contextual layer while preserving workspace
// bindings. It remains useful for focused overlay tests.
func (h *Help) SetScreenKeybinds(screenID string, binds []shell.Keybind) {
	h.screenID = screenID
	h.screenBinds = binds
}

// Update handles keys while the overlay is open.
func (h *Help) Update(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "esc", "?":
		h.Close()
	case "backspace":
		if len(h.filter) > 0 {
			h.filter = h.filter[:len(h.filter)-1]
		}
	default:
		if msg.Text != "" {
			h.filter += msg.Text
		}
	}
	return nil
}

type keyGroup struct {
	title string
	items [][2]string // [key, label]
}

// View renders the help overlay sized to fit roughly 80×~24 in a modal.
func (h *Help) View(viewportWidth, viewportHeight int) string {
	if !h.open {
		return ""
	}
	w := 88
	if w > viewportWidth-4 {
		w = viewportWidth - 4
	}
	colW := (w - 4) / 3
	if colW < 1 {
		colW = 1
	}

	header := " " + shell.TealBold.Render("? help") + "  " +
		shell.TextMuted.Render("keybinds · type to filter · esc to close")
	header = padTo(header, w)

	groups := make([]keyGroup, 0, 2)
	if len(h.workspaceBinds) > 0 {
		groups = append(groups, keyGroup{title: "Workspace", items: helpItems(h.workspaceBinds)})
	}
	if len(h.screenBinds) > 0 {
		title := "Act"
		if h.screenID != "" {
			title = fmt.Sprintf("Act · %s", h.screenID)
		}
		groups = append(groups, keyGroup{title: title, items: helpItems(h.screenBinds)})
	}

	// Build groups, possibly filtered. Layout into 3 columns by index.
	cols := make([][]string, 3)
	for i, g := range groups {
		if !h.matchesFilter(g) {
			continue
		}
		col := i % 3
		var sub strings.Builder
		sub.WriteString(" " + shell.SectionTag.Render(g.title) + "\n")
		for _, item := range g.items {
			if h.filter != "" && !strings.Contains(strings.ToLower(item[0]+" "+item[1]), strings.ToLower(h.filter)) {
				continue
			}
			key := lipgloss.NewStyle().
				Background(shell.ColorSurface).
				Foreground(shell.ColorTeal).
				Padding(0, 1).
				Render(padString2(item[0], 6))
			sub.WriteString(" " + key + "  " + shell.TextDim.Render(item[1]) + "\n")
		}
		cols[col] = append(cols[col], sub.String())
	}

	colStr := make([]string, 3)
	for i, c := range cols {
		colStr[i] = strings.Join(c, "\n")
	}
	maxH := 0
	for _, c := range colStr {
		ch := strings.Count(c, "\n") + 1
		if ch > maxH {
			maxH = ch
		}
	}

	colA := kit.PadBlock(colStr[0], colW, maxH)
	colB := kit.PadBlock(colStr[1], colW, maxH)
	colC := kit.PadBlock(colStr[2], colW, maxH)
	body := kit.ComposeColumns(colA, colB, colC)

	border := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		BorderForeground(shell.ColorBorderBright).
		Border(lipgloss.RoundedBorder()).
		Render

	inner := header + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		body
	return border(inner)
}

func helpItems(bindings []shell.Keybind) [][2]string {
	items := make([][2]string, 0, len(bindings))
	for _, binding := range bindings {
		items = append(items, [2]string{binding.Key, binding.Label})
	}
	return items
}

func (h *Help) matchesFilter(g keyGroup) bool {
	if h.filter == "" {
		return true
	}
	q := strings.ToLower(h.filter)
	if strings.Contains(strings.ToLower(g.title), q) {
		return true
	}
	for _, item := range g.items {
		if strings.Contains(strings.ToLower(item[0]+" "+item[1]), q) {
			return true
		}
	}
	return false
}

func padString2(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}
