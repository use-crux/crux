package kit

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// DocumentPosition describes the visible wrapped-line range of a
// DocumentPane. FirstLine and LastLine are one-based and are zero when the
// document is empty.
type DocumentPosition struct {
	FirstLine  int
	LastLine   int
	TotalLines int
	Offset     int
}

// DocumentPane owns focus, sizing, wrapping, and vertical scrolling for one
// identified document. Callers retain ownership of the document's semantics.
type DocumentPane struct {
	documentID string
	content    string
	source     []string
	lines      []documentLine
	width      int
	height     int
	offset     int
	focused    bool
}

type documentLine struct {
	text       string
	sourceLine int
	sourceCell int
}

type documentAnchor struct {
	sourceLine int
	sourceCell int
	valid      bool
}

// NewDocumentPane constructs an empty document viewport.
func NewDocumentPane() *DocumentPane {
	return &DocumentPane{}
}

// SetContent replaces the identified document. A new identity starts at the
// beginning; updates to the same identity preserve the current logical source
// line where possible.
func (p *DocumentPane) SetContent(documentID, content string) {
	if documentID == p.documentID && content == p.content {
		return
	}
	changedDocument := documentID != p.documentID
	anchor := p.topAnchor()
	p.documentID = documentID
	p.content = content
	p.source = splitDocument(content)
	if changedDocument {
		anchor.valid = false
	}
	p.rewrap(anchor)
}

// SetSize updates the concrete rendering bounds.
func (p *DocumentPane) SetSize(width, height int) {
	width = nonNegative(width)
	height = nonNegative(height)
	if width == p.width && height == p.height {
		return
	}
	if width == p.width {
		p.height = height
		p.clampOffset()
		return
	}
	anchor := p.topAnchor()
	p.width = width
	p.height = height
	p.rewrap(anchor)
}

// SetFocused controls whether Update consumes navigation input.
func (p *DocumentPane) SetFocused(focused bool) {
	p.focused = focused
}

// Position returns one-based visible wrapped-line metadata and the zero-based
// scroll offset.
func (p *DocumentPane) Position() DocumentPosition {
	if len(p.lines) == 0 || p.height == 0 {
		return DocumentPosition{TotalLines: len(p.lines), Offset: p.offset}
	}
	last := min(len(p.lines), p.offset+p.height)
	return DocumentPosition{
		FirstLine:  p.offset + 1,
		LastLine:   last,
		TotalLines: len(p.lines),
		Offset:     p.offset,
	}
}

// Update applies focused line navigation and reports whether the pane consumed
// the message.
func (p *DocumentPane) Update(msg tea.Msg) bool {
	if !p.focused {
		return false
	}
	if wheel, ok := msg.(tea.MouseWheelMsg); ok {
		switch wheel.Button {
		case tea.MouseWheelDown:
			p.scroll(1)
			return true
		case tea.MouseWheelUp:
			p.scroll(-1)
			return true
		default:
			return false
		}
	}
	key, ok := msg.(tea.KeyPressMsg)
	if !ok {
		return false
	}
	switch key.String() {
	case "j", "down":
		p.scroll(1)
		return true
	case "k", "up":
		p.scroll(-1)
		return true
	case "pgdown":
		p.scroll(max(1, p.height))
		return true
	case "pgup":
		p.scroll(-max(1, p.height))
		return true
	case "home":
		p.offset = 0
		return true
	case "end":
		p.offset = len(p.lines)
		p.clampOffset()
		return true
	default:
		return false
	}
}

// Render returns visible lines padded or clipped to the pane's concrete size.
func (p *DocumentPane) Render() []string {
	if p.width == 0 || p.height == 0 || len(p.lines) == 0 {
		return nil
	}
	end := min(len(p.lines), p.offset+p.height)
	lines := make([]string, 0, p.height)
	for _, line := range p.lines[p.offset:end] {
		lines = append(lines, fitLine(line.text, p.width))
	}
	for len(lines) < p.height {
		lines = append(lines, strings.Repeat(" ", p.width))
	}
	return lines
}

func (p *DocumentPane) scroll(delta int) {
	p.offset += delta
	p.clampOffset()
}

func (p *DocumentPane) clampOffset() {
	maxOffset := len(p.lines) - p.height
	if maxOffset < 0 {
		maxOffset = 0
	}
	if p.offset < 0 {
		p.offset = 0
	}
	if p.offset > maxOffset {
		p.offset = maxOffset
	}
}

func (p *DocumentPane) rewrap(anchor documentAnchor) {
	p.lines = p.lines[:0]
	for sourceLine, source := range p.source {
		wrapped := source
		if p.width > 0 {
			wrapped = lipgloss.Wrap(source, p.width, "/._")
		}
		parts := strings.Split(wrapped, "\n")
		plainSource := ansi.Strip(source)
		sourceByte := 0
		sourceCell := 0
		for _, part := range parts {
			plainPart := ansi.Strip(part)
			remaining := plainSource[sourceByte:]
			if skipped := strings.Index(remaining, plainPart); skipped >= 0 {
				sourceCell += lipgloss.Width(remaining[:skipped])
				sourceByte += skipped
			}
			p.lines = append(p.lines, documentLine{
				text:       part,
				sourceLine: sourceLine,
				sourceCell: sourceCell,
			})
			sourceCell += lipgloss.Width(plainPart)
			sourceByte += len(plainPart)
		}
	}
	p.offset = 0
	if anchor.valid {
		best := -1
		for i, line := range p.lines {
			if line.sourceLine != anchor.sourceLine {
				continue
			}
			if line.sourceCell > anchor.sourceCell {
				break
			}
			best = i
		}
		if best >= 0 {
			p.offset = best
		}
	}
	p.clampOffset()
}

func (p *DocumentPane) topAnchor() documentAnchor {
	if p.offset < 0 || p.offset >= len(p.lines) {
		return documentAnchor{}
	}
	line := p.lines[p.offset]
	return documentAnchor{sourceLine: line.sourceLine, sourceCell: line.sourceCell, valid: true}
}

func splitDocument(content string) []string {
	content = strings.TrimRight(content, "\n")
	if content == "" {
		return nil
	}
	return strings.Split(content, "\n")
}
