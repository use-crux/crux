package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var workbenchStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

// View renders the complete Workbench chrome and active workflow.
func (w *Workbench) View() string {
	if w.width == 0 || w.height == 0 {
		return ""
	}

	root := kit.Rect{W: w.width, H: w.height}
	path, right := w.breadcrumbContent()
	base := kit.ReconcileBorders(strings.Join(w.layoutBody(root, path, right), "\n"))

	switch {
	case w.palette.IsOpen():
		return overlayOnto(base, w.palette.View(w.width, w.height), w.width, w.height)
	case w.help.IsOpen():
		return overlayOnto(base, w.help.View(w.width, w.height), w.width, w.height)
	case w.inspect.IsOpen():
		return overlayOnto(base, w.inspect.View(w.width, w.height), w.width, w.height)
	case w.definitionChooser.IsOpen():
		return overlayOnto(base, w.definitionChooser.View(), w.width, w.height)
	default:
		return base
	}
}

func (w *Workbench) layoutBody(root kit.Rect, path []string, right string) []string {
	if kit.Classify(root.W) == kit.LayoutSingle {
		rows := kit.SplitV(root, kit.Fill(), kit.Fixed(1), kit.Fixed(1))
		return append(
			w.layoutScreenColumn(rows[0], path, right),
			shell.HorizontalBorder(rows[1].W),
			shell.StatusBar(rows[2].W, w.statusKeybinds(), w.statusBadge()),
		)
	}

	panes := kit.SplitH(root, kit.Fixed(shell.NavRailWidth), kit.Fill())
	rail := shell.NavRail(panes[0].H, w.navWithCounts(), w.activeNav, shell.NavRailFooter{
		TargetID:         w.devContext.Target.ID,
		TargetKind:       w.devContext.Target.Kind,
		TargetModel:      w.devContext.Target.Model,
		BaselineLabel:    w.devContext.Baseline.Label,
		BaselineRelative: w.devContext.Baseline.PromotedAtRelative,
	})
	rightRows := kit.SplitV(kit.Rect{W: panes[1].W, H: panes[1].H}, kit.Fill(), kit.Fixed(1), kit.Fixed(1))
	rightColumn := append(
		w.layoutScreenColumn(rightRows[0], path, right),
		shell.HorizontalBorder(rightRows[1].W),
		shell.StatusBar(rightRows[2].W, w.statusKeybinds(), w.statusBadge()),
	)
	return kit.ComposeStyled(panes, [][]string{
		blockLines(rail),
		rightColumn,
	}, workbenchStyles)
}

func (w *Workbench) layoutScreenColumn(r kit.Rect, path []string, right string) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	breadcrumb := shell.Breadcrumb(r.W, path, right)
	// Render one logical row through the shared status seam; PadBlock clips
	// that structural continuation to the column before the boundary is drawn.
	screenH := max(0, r.H-len(blockLines(breadcrumb))+1)
	screenView := w.activeScreen().View(screens.Size{Width: r.W, Height: screenH})
	framed := shell.FrameScreen(r.W, breadcrumb, screenView)
	return blockLines(kit.PadBlock(framed, r.W, r.H))
}

func overlayOnto(base, overlay string, width, height int) string {
	if overlay == "" {
		return base
	}
	baseLines := strings.Split(base, "\n")
	overlayLines := strings.Split(overlay, "\n")
	overlayWidth := 0
	for _, line := range overlayLines {
		overlayWidth = max(overlayWidth, lipgloss.Width(line))
	}
	left := max(0, (width-overlayWidth)/2)
	top := max(0, (height-len(overlayLines))/3)
	canvasHeight := max(len(baseLines), height)
	canvas := strings.Split(kit.PadBlock(base, width, canvasHeight), "\n")
	overlayWidth = min(width, overlayWidth)
	for row, line := range overlayLines {
		y := top + row
		if y >= len(canvas) {
			break
		}
		// A partial base row reads as a path or prose fragment beside a modal.
		// Make every occupied row opaque across the viewport and isolate SGR at
		// both seams; rows above and below still show the complete base.
		right := max(0, width-left-overlayWidth)
		canvas[y] = ansi.ResetStyle +
			strings.Repeat(" ", left) +
			kit.Fit(line, overlayWidth, "") +
			ansi.ResetStyle +
			strings.Repeat(" ", right)
	}
	return strings.Join(canvas, "\n")
}

func blockLines(value string) []string {
	if value == "" {
		return nil
	}
	return strings.Split(strings.TrimRight(value, "\n"), "\n")
}

// contextMeta composes independently droppable right-side breadcrumb segments.
// shell.Breadcrumb removes these from the right when the terminal narrows.
func (w *Workbench) contextMeta() string {
	parts := make([]string, 0, 5)
	if w.serverURL != "" {
		// OSC 8 links are decorated with an underline by several terminals even
		// when the text style does not request one. Keep the persistent local
		// host label accent-only so underscores remain visually crisp.
		parts = append(parts, shell.Teal.Render("local "+compactURLLabel(w.serverURL)))
	}
	if w.tunnelURL != "" {
		parts = append(parts, osc8Link(w.tunnelURL, "tunnel "+compactURLLabel(w.tunnelURL)))
	}
	if w.ingestTokenPath != "" {
		parts = append(parts, "ingest token "+w.ingestTokenPath)
	}
	if w.devContext.Version != "" {
		parts = append(parts, w.devContext.Version)
	}
	if w.devContext.Project.Name != "" {
		parts = append(parts, "project · "+w.devContext.Project.Name)
	}
	if w.devContext.Git.Branch != "" {
		git := w.devContext.Git.Branch
		if w.devContext.Git.CommitSHA != "" {
			git += " @ " + truncateStr(w.devContext.Git.CommitSHA, 7)
		}
		if w.devContext.Git.Dirty {
			git += " *"
		}
		parts = append(parts, git)
	}
	return strings.Join(parts, "  ·  ")
}

func (w *Workbench) projectSubtitle() string {
	if w.devContext.Project.Name == "" {
		return w.serverURL
	}
	suffix := ""
	if w.devContext.Git.Branch != "" {
		suffix = " · " + w.devContext.Git.Branch
		if w.devContext.Git.CommitSHA != "" {
			suffix += " @ " + truncateStr(w.devContext.Git.CommitSHA, 7)
		}
	}
	return fmt.Sprintf("%s%s", w.devContext.Project.Name, suffix)
}

func truncateStr(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

// osc8Link wraps text in the terminal hyperlink protocol while retaining a
// readable label in terminals that ignore the escape sequence.
func osc8Link(url, text string) string {
	return "\x1b]8;;" + url + "\x07" + shell.Teal.Render(text) + "\x1b]8;;\x07"
}

func compactURLLabel(raw string) string {
	label := raw
	if index := strings.Index(label, "://"); index >= 0 {
		label = label[index+3:]
	}
	if index := strings.IndexAny(label, "?#"); index >= 0 {
		label = label[:index]
	}
	return label
}
