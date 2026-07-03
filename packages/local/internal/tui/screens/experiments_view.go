package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Experiments) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading experiments...")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if size.Width <= 0 || size.Height <= 0 {
		return ""
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no experiments yet - run `crux quality run` to create one.")
	}

	root := kit.Rect{W: size.Width, H: size.Height}
	switch kit.Classify(size.Width) {
	case kit.LayoutFull, kit.LayoutTwo:
		panes := kit.SplitH(root, kit.Ratio(2, 5), kit.Fill())
		return strings.Join(kit.ComposeStyled(panes, [][]string{
			s.renderListLines(panes[0]),
			s.renderDetailLines(panes[1]),
		}, experimentsStyles), "\n")
	default:
		if s.focus == expFocusDetail {
			return strings.Join(s.renderDetailLines(root), "\n")
		}
		return strings.Join(s.renderListLines(root), "\n")
	}
}

func (s *Experiments) renderListLines(r kit.Rect) []string {
	header := shell.PaneHeader(r.W, "Experiments", fmt.Sprintf("%d", len(s.items)), "")
	bodyH := r.H - lineCount(header)
	lines := strings.Split(header, "\n")
	if bodyH > 0 {
		s.table.SetHeight(bodyH)
		lines = append(lines, s.table.Render(r.W, experimentsStyles)...)
	}
	return blockLines(strings.Join(lines, "\n"), r)
}

func (s *Experiments) renderDetailLines(r kit.Rect) []string {
	cur := s.currentSummary()
	if cur == nil {
		return blockLines(centerMsg(Size{Width: r.W, Height: r.H}, "select an experiment"), r)
	}
	if s.detail == nil || s.detail.ExperimentID != cur.ExperimentID {
		return blockLines(centerMsg(Size{Width: r.W, Height: r.H}, "loading experiment record..."), r)
	}

	header := s.detailHeader(r.W)
	lines := strings.Split(header, "\n")
	if s.notice != "" {
		lines = append(lines, padRow(" "+experimentsStyles.Green.Render(s.notice), r.W))
	}
	lines = append(lines, s.progressLines(r.W)...)
	lines = append(lines, sectionLine("VARIANTS x METRICS", r.W))
	lines = append(lines, kit.Matrix(s.variantMetrics(), kit.Rect{W: r.W, H: matrixHeight(r.H)}, 0, experimentsStyles)...)
	if callout := s.promotionCallout(r.W); callout != "" {
		lines = append(lines, callout)
	}
	lines = append(lines, sectionLine("VARIANT CONFIG DIFF", r.W))
	lines = append(lines, kit.DiffBlock(s.variantDiffLines(), kit.Rect{W: r.W, H: 5}, experimentsStyles)...)
	lines = append(lines, s.failingCellLines(r.W)...)
	return blockLines(strings.Join(lines, "\n"), r)
}

func (s *Experiments) detailHeader(width int) string {
	detail := s.detail
	badges := []string{}
	if s.isRunning() {
		badges = append(badges, kit.Badge("running", theme.ToneTeal, experimentsStyles))
	}
	if detail.Replay.Mode != "" {
		badges = append(badges, kit.Badge(detail.Replay.Mode, theme.ToneBlue, experimentsStyles))
	}
	title := shortID(detail.ExperimentID, 16) + " · " + detail.EvaluationID
	if detail.ExperimentLabel != "" {
		title += " · " + detail.ExperimentLabel
	}
	return shell.PaneHeader(width, title, strings.Join(badges, " "), "")
}

func (s *Experiments) progressLines(width int) []string {
	if !s.isRunning() {
		return nil
	}
	summary := s.currentSummary()
	if summary == nil {
		return nil
	}
	done, total := runningProgress(summary)
	left := fmt.Sprintf(" ◆ running · %d/%d cases x %d variants · 0 provider calls", done, total, len(summary.Variants))
	barW := width - len("  ") - 30
	if barW < 8 {
		barW = 8
	}
	bar := kit.ProgressBar(progressFrac(done, total), barW, theme.ToneTeal, experimentsStyles)
	line := padRow(experimentsStyles.ToneStyle(theme.ToneTeal).Render(left)+" "+bar+" "+experimentsStyles.Dim.Render("seed 42 temp 0"), width)
	return []string{line, strings.Repeat(" ", maxInt(0, width))}
}

func sectionLine(title string, width int) string {
	return padRow(" "+experimentsStyles.Accent.Render(title), width)
}

func matrixHeight(total int) int {
	if total < 24 {
		return 7
	}
	if total > 34 {
		return 8
	}
	return 7
}

func lineCount(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(s, "\n") + 1
}
