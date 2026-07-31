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

// View renders the help overlay sized to its executable key groups.
func (h *Help) View(viewportWidth, viewportHeight int) string {
	if !h.open {
		return ""
	}
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

	filtered := filterHelpGroups(groups, h.filter)
	if len(filtered) == 0 {
		filtered = append(filtered, keyGroup{title: "No matches"})
	}

	headerText := "? help  keybinds · type to filter · esc to close"
	naturalColWidth := 20
	for _, g := range filtered {
		naturalColWidth = max(naturalColWidth, longestHelpLine(g)+2)
	}
	dividerCells := len(filtered) - 1
	longest := max(len(headerText), naturalColWidth*len(filtered)+dividerCells)
	maxBodyRows := 1
	for _, g := range filtered {
		maxBodyRows = max(maxBodyRows, len(g.items)+1)
	}
	size := contentModalSize(viewportWidth, viewportHeight, longest, maxBodyRows, 4)
	w := size.innerWidth
	columnCells := max(len(filtered), w-dividerCells)
	colW := columnCells / len(filtered)
	extraCells := columnCells % len(filtered)
	bodyRows := max(1, size.outerHeight-4)

	cols := make([]string, 0, len(filtered))
	for index, g := range filtered {
		width := colW
		if index < extraCells {
			width++
		}
		var sub strings.Builder
		sub.WriteString(" " + shell.SectionTag.Render(g.title) + "\n")
		for _, item := range g.items[:min(len(g.items), max(0, bodyRows-1))] {
			key := lipgloss.NewStyle().
				Background(shell.ColorSurface).
				Foreground(shell.ColorTeal).
				Padding(0, 1).
				Render(padString2(item[0], 6))
			sub.WriteString(" " + key + "  " + shell.TextDim.Render(item[1]) + "\n")
		}
		cols = append(cols, kit.PadBlock(sub.String(), width, bodyRows))
	}

	header := " " + shell.TealBold.Render("? help") + "  " +
		shell.TextMuted.Render("keybinds · type to filter · esc to close")
	header = padTo(header, w)
	body := kit.ComposeColumnsOpen(cols...)

	inner := header + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		body
	return renderModal(inner, w)
}

func longestHelpLine(group keyGroup) int {
	longest := len(group.title)
	for _, item := range group.items {
		longest = max(longest, 11+lipgloss.Width(item[1]))
	}
	return longest
}

func helpItems(bindings []shell.Keybind) [][2]string {
	items := make([][2]string, 0, len(bindings))
	for _, binding := range bindings {
		items = append(items, [2]string{binding.Key, binding.Label})
	}
	return items
}

func filterHelpGroups(groups []keyGroup, filter string) []keyGroup {
	if filter == "" {
		return groups
	}
	q := strings.ToLower(filter)
	filtered := make([]keyGroup, 0, len(groups))
	for _, group := range groups {
		if strings.Contains(strings.ToLower(group.title), q) {
			filtered = append(filtered, group)
			continue
		}
		items := make([][2]string, 0, len(group.items))
		for _, item := range group.items {
			if strings.Contains(strings.ToLower(item[0]+" "+item[1]), q) {
				items = append(items, item)
			}
		}
		if len(items) > 0 {
			filtered = append(filtered, keyGroup{title: group.title, items: items})
		}
	}
	return filtered
}

func padString2(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}
