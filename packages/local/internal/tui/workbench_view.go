package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
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
	regions := kit.SplitV(root, kit.Fill(), kit.Fixed(1))
	bodyRect, statusRect := regions[0], regions[1]
	statusBar := shell.StatusBar(statusRect.W, w.statusKeybinds(), w.statusText(statusRect.W))
	path, right := w.breadcrumbContent()
	base := strings.Join(append(w.layoutBody(bodyRect, path, right), statusBar), "\n")

	switch {
	case w.palette.IsOpen():
		return overlayOnto(base, w.palette.View(w.width, w.height), w.width, 1)
	case w.help.IsOpen():
		return overlayOnto(base, w.help.View(w.width, w.height), w.width, 0)
	case w.inspect.IsOpen():
		return overlayOnto(base, w.inspect.View(w.width, w.height), w.width, 0)
	case w.definitionChooser.IsOpen():
		return overlayOnto(base, w.definitionChooser.View(), w.width, 1)
	default:
		return base
	}
}

func (w *Workbench) layoutBody(bodyRect kit.Rect, path []string, right string) []string {
	if kit.Classify(bodyRect.W) == kit.LayoutSingle {
		return w.layoutScreenColumn(bodyRect, path, right)
	}

	panes := kit.SplitH(bodyRect, kit.Fixed(shell.NavRailWidth), kit.Fill())
	rail := shell.NavRail(panes[0].H, w.navWithCounts(), w.activeNav, shell.NavRailFooter{
		TargetID:         w.devContext.Target.ID,
		TargetKind:       w.devContext.Target.Kind,
		TargetModel:      w.devContext.Target.Model,
		BaselineLabel:    w.devContext.Baseline.Label,
		BaselineRelative: w.devContext.Baseline.PromotedAtRelative,
	})
	return kit.ComposeStyled(panes, [][]string{
		blockLines(rail),
		w.layoutScreenColumn(panes[1], path, right),
	}, workbenchStyles)
}

func (w *Workbench) layoutScreenColumn(r kit.Rect, path []string, right string) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	breadcrumb := shell.Breadcrumb(r.W, path, right)
	screenH := max(0, r.H-len(blockLines(breadcrumb)))
	screenView := w.activeScreen().View(screens.Size{Width: r.W, Height: screenH})
	return blockLines(kit.PadBlock(breadcrumb+"\n"+screenView, r.W, r.H))
}

func overlayOnto(base, overlay string, width, top int) string {
	if overlay == "" {
		return base
	}
	baseLines := strings.Split(base, "\n")
	overlayLines := strings.Split(overlay, "\n")
	overlayWidth := 0
	for _, line := range overlayLines {
		overlayWidth = max(overlayWidth, lipgloss.Width(line))
	}
	leftPad := 0
	if overlayWidth < width {
		leftPad = max(1, (width-overlayWidth)/2)
	}
	height := max(len(baseLines), top+len(overlayLines))
	canvas := lipgloss.NewCanvas(width, height)
	canvas.Compose(lipgloss.NewLayer(base))
	canvas.Compose(lipgloss.NewLayer(overlay).X(leftPad).Y(top).Z(1))
	return kit.PadBlock(canvas.Render(), width, height)
}

func blockLines(value string) []string {
	if value == "" {
		return nil
	}
	return strings.Split(strings.TrimRight(value, "\n"), "\n")
}

// contextMeta composes the right-side block of the breadcrumb row.
func (w *Workbench) contextMeta() string {
	parts := make([]string, 0, 5)
	if w.serverURL != "" {
		parts = append(parts, osc8Link(w.serverURL, "local "+compactURLLabel(w.serverURL)))
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
	return "\x1b]8;;" + url + "\x07" + text + "\x1b]8;;\x07"
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
