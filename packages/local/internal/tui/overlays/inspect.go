package overlays

import (
	"encoding/json"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Inspect is the `o open in viewer` overlay for a span. Shows the full
// JSON payload in a scrollable modal so the user can see args/result/
// messages/etc. that don't fit in the right-pane summary.
type Inspect struct {
	open     bool
	title    string
	subtitle string
	body     string
	lines    []string
	scroll   int
}

// NewInspect constructs an empty inspect overlay.
func NewInspect() *Inspect { return &Inspect{} }

// Open shows the overlay with the given header + JSON payload.
func (i *Inspect) Open(title, subtitle string, payload json.RawMessage) {
	i.open = true
	i.title = title
	i.subtitle = subtitle
	i.scroll = 0
	// Pretty-print whatever JSON came in.
	pretty := prettyJSON(payload)
	i.body = pretty
	i.lines = strings.Split(pretty, "\n")
}

// Close hides the overlay.
func (i *Inspect) Close() { i.open = false }

// IsOpen reports whether the overlay is shown.
func (i *Inspect) IsOpen() bool { return i.open }

// Update handles keys while the overlay is open. Returns a tea.Cmd (none
// generated today; reserved for future copy/export actions).
func (i *Inspect) Update(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "esc", "o", "q":
		i.Close()
	case "j", "down":
		if i.scroll < len(i.lines)-1 {
			i.scroll++
		}
	case "k", "up":
		if i.scroll > 0 {
			i.scroll--
		}
	case "g":
		i.scroll = 0
	case "G":
		i.scroll = len(i.lines) - 1
		if i.scroll < 0 {
			i.scroll = 0
		}
	case "ctrl+d", "pgdown":
		i.scroll += 10
		if i.scroll > len(i.lines)-1 {
			i.scroll = len(i.lines) - 1
		}
	case "ctrl+u", "pgup":
		i.scroll -= 10
		if i.scroll < 0 {
			i.scroll = 0
		}
	}
	return nil
}

// View renders the modal. Caller composites this onto the workbench
// base; this returns the block sized to (viewportWidth-12, viewportHeight-8).
func (i *Inspect) View(viewportWidth, viewportHeight int) string {
	if !i.open {
		return ""
	}
	w := viewportWidth - 12
	if w > 120 {
		w = 120
	}
	if w < 40 {
		w = 40
	}
	h := viewportHeight - 8
	if h > 40 {
		h = 40
	}
	if h < 10 {
		h = 10
	}

	header := " " + shell.TealBold.Render("◧ inspect · "+i.title) +
		"  " + shell.TextMuted.Render(i.subtitle)
	header = padToWidth(header, w)

	// Visible window into the body.
	bodyRows := h - 4 // header + 2 rules + footer
	if bodyRows < 1 {
		bodyRows = 1
	}
	visible := i.lines
	start := i.scroll
	if start > len(visible)-bodyRows {
		start = len(visible) - bodyRows
	}
	if start < 0 {
		start = 0
	}
	end := start + bodyRows
	if end > len(visible) {
		end = len(visible)
	}
	rows := visible[start:end]
	for len(rows) < bodyRows {
		rows = append(rows, "")
	}
	// Render each row inside the panel.
	rowStyle := lipgloss.NewStyle().Foreground(shell.ColorText)
	body := make([]string, len(rows))
	for j, r := range rows {
		body[j] = padToWidth(" "+rowStyle.Render(truncateRight(r, w-2)), w)
	}

	footer := " " + shell.TextMuted.Render(
		shell.Teal.Render("j/k")+" scroll  "+
			shell.Teal.Render("g/G")+" top/bottom  "+
			shell.Teal.Render("^d/^u")+" page  "+
			shell.Teal.Render("esc")+" close",
	) + "  " + shell.TextMuted.Render(
		"line "+formatInt(i.scroll+1)+" / "+formatInt(len(i.lines)),
	)
	footer = padToWidth(footer, w)

	border := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		BorderForeground(shell.ColorBorderBright).
		Border(lipgloss.RoundedBorder()).
		Render

	rule := lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w))
	inner := header + "\n" + rule + "\n" +
		strings.Join(body, "\n") + "\n" + rule + "\n" + footer
	return border(inner)
}

func prettyJSON(raw json.RawMessage) string {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return string(raw)
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return string(raw)
	}
	return string(b)
}

func padToWidth(s string, width int) string {
	return fitToWidth(s, width)
}

func truncateRight(s string, width int) string {
	if lipgloss.Width(s) <= width {
		return s
	}
	if width <= 1 {
		return s[:width]
	}
	// Naive byte-truncation suffices for JSON which is ASCII-dominant.
	if len(s) > width-1 {
		s = s[:width-1] + "…"
	}
	return s
}

func formatInt(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if neg {
		return "-" + string(digits)
	}
	return string(digits)
}
