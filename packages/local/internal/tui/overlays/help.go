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
// The help renders two layers:
//
//   - Layer 1 (truly global) — palette, this help, jump, search, quit, j/k,
//     h/l. These are shell-owned and always visible.
//   - Focused screen actions — injected via SetScreenKeybinds. The Act
//     section is named after the active screen and lists its own keymap.
type Help struct {
	open   bool
	filter string

	screenID    string
	screenBinds []shell.Keybind
}

// NewHelp constructs the help overlay.
func NewHelp() *Help { return &Help{} }

// Open shows the overlay.
func (h *Help) Open() { h.open = true; h.filter = "" }

// Close hides the overlay.
func (h *Help) Close() { h.open = false }

// IsOpen reports whether the overlay is shown.
func (h *Help) IsOpen() bool { return h.open }

// SetScreenKeybinds wires the active screen's keymap into the overlay so
// the Act section can be rendered contextually. Call this before View() —
// the workbench updates it whenever the active screen changes or the
// active screen flips between browsing and editing.
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

// staticGroups holds the truly-global Layer-1 chords that are always
// visible regardless of which screen is focused. The Act section is
// composed dynamically from the focused screen's Keybinds() — it is NOT
// in this list.
var staticGroups = []keyGroup{
	{
		title: "Move",
		items: [][2]string{
			{"j / k", "next / prev row"},
			{"h / l", "next / prev pane"},
			{"g g", "top"},
			{"G", "bottom"},
			{"↵", "open / expand"},
			{"esc", "back / cancel"},
		},
	},
	{
		title: "Navigate",
		items: [][2]string{
			{"g o", "overview"},
			{"g i", "insights"},
			{"g r", "runs"},
			{"g d", "index"},
			{"1-4", "numeric jump to nav rail"},
		},
	},
	{
		title: "Shell",
		items: [][2]string{
			{":", "command palette"},
			{"/", "search this pane"},
			{"?", "this help"},
			{"q", "quit"},
		},
	},
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

	// Compose the group list: static Layer-1 groups + a per-screen Act
	// group built from the focused screen's keybinds (if any). The Act
	// group's title carries the screen id so users see *which* screen's
	// keymap they are reading.
	groups := make([]keyGroup, 0, len(staticGroups)+1)
	groups = append(groups, staticGroups...)
	if len(h.screenBinds) > 0 {
		title := "Act"
		if h.screenID != "" {
			title = fmt.Sprintf("Act · %s", h.screenID)
		}
		items := make([][2]string, 0, len(h.screenBinds))
		for _, b := range h.screenBinds {
			items = append(items, [2]string{b.Key, b.Label})
		}
		groups = append(groups, keyGroup{title: title, items: items})
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

	footer := " " + shell.TextMuted.Render(
		"config: "+shell.Text.Render(".crux/keybinds.toml")+
			"  ·  "+shell.Teal.Render(":keybind set")+" to remap",
	)
	footer = padTo(footer, w)

	border := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		BorderForeground(shell.ColorBorderBright).
		Border(lipgloss.RoundedBorder()).
		Render

	inner := header + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		body + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		footer
	return border(inner)
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
