package screens

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var cassettesStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

func (s *Cassettes) renderDetail(width, height int) string {
	cur := s.currentCassette()
	if cur == nil {
		return centerMsg(Size{Width: width, Height: height}, "select a cassette")
	}

	subtitle := fmt.Sprintf("%d entries · %s", cur.EntryCount, formatBytes(cur.SizeBytes))
	if cur.Stale {
		subtitle += " · " + shell.Amber.Render("stale")
	}
	header := shell.PaneHeader(width, cur.Name, subtitle, "")
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	b.WriteString(renderCassetteStats(*cur, width))

	b.WriteString("\n " + shell.SectionTag.Render("FILE"))
	b.WriteString("\n")
	b.WriteString(kvRow("path", cur.Path, width))
	b.WriteString(kvRow("recorded", cur.RecordedAt, width))
	b.WriteString(kvRow("sdk", cur.SdkVersion, width))
	b.WriteString(kvRow("size", formatBytes(cur.SizeBytes), width))
	b.WriteString(kvRow("entries", fmt.Sprintf("%d", cur.EntryCount), width))

	if len(cur.Models) > 0 {
		b.WriteString("\n " + shell.SectionTag.Render("MODELS"))
		b.WriteString("\n")
		for _, m := range cur.Models {
			b.WriteString(padRow(" "+shell.TextDim.Render(m), width))
			b.WriteString("\n")
		}
	}

	b.WriteString("\n " + shell.SectionTag.Render("DRIFT"))
	b.WriteString("\n")
	b.WriteString(strings.Join(renderCassetteDrift(*cur, width), "\n"))
	b.WriteString("\n")

	hdrH := strings.Count(header, "\n") + 1
	return kit.PadBlock(b.String(), width, height-hdrH+1)
}

func renderCassetteStats(cur api.QualityCassetteFileRecord, width int) string {
	cols := []string{"entries", "hit %", "missing", "mismatch"}
	values := []string{fmt.Sprintf("%d", cur.EntryCount), "n/a", staleCount(cur), staleCount(cur)}
	cellW := maxInt(8, width/4)
	var b strings.Builder
	for i, col := range cols {
		b.WriteString(shell.SectionTag.Render(padString2(col, cellW)))
		if i == len(cols)-1 {
			break
		}
	}
	b.WriteString("\n")
	for i, value := range values {
		style := shell.TextDim
		if cur.Stale && (i == 2 || i == 3) {
			style = shell.Amber
		}
		b.WriteString(style.Render(padString2(value, cellW)))
		if i == len(values)-1 {
			break
		}
	}
	b.WriteString("\n")
	return b.String()
}

func renderCassetteDrift(cur api.QualityCassetteFileRecord, width int) []string {
	if !cur.Stale {
		return []string{padRow(shell.TextDim.Render("no drift detected from available cassette summary"), width)}
	}
	lines := []kit.DiffLine{
		{Kind: "-", Text: "recorded cassette is older than replay freshness window"},
		{Kind: "+", Text: "refresh through the quality run replay workflow"},
	}
	return kit.DiffBlock(lines, kit.Rect{W: width, H: 2}, cassettesStyles)
}

func staleCount(cur api.QualityCassetteFileRecord) string {
	if cur.Stale {
		return "1"
	}
	return "0"
}

func formatBytes(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}
