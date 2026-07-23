package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestEscapeMarkdownTreatsEngineStringsAsPlainText(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "markdown punctuation",
			input: "`code` [x](y) <script> *bold* _italic_ # heading | cell",
			want:  "\\`code\\` \\[x\\](y) \\<script\\> \\*bold\\* \\_italic\\_ \\# heading \\| cell",
		},
		{
			name:  "backslashes cannot reactivate escaped punctuation",
			input: `\*literal`,
			want:  `\\\*literal`,
		},
		{
			name:  "newlines and control characters collapse to spaces",
			input: "first\r\nsecond\t\x00 third",
			want:  "first second third",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := escapeMarkdown(test.input); got != test.want {
				t.Fatalf("escapeMarkdown(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestRangeContainsHoverPosition(t *testing.T) {
	t.Parallel()

	position := func(line, character uint32) protocol.Position {
		return protocol.Position{Line: line, Character: character}
	}
	tests := []struct {
		name     string
		range_   protocol.Range
		position protocol.Position
		want     bool
	}{
		{
			name: "collapsed marker matches exactly",
			range_: protocol.Range{
				Start: position(2, 4),
				End:   position(2, 4),
			},
			position: position(2, 4), want: true,
		},
		{
			name: "collapsed marker rejects another position",
			range_: protocol.Range{
				Start: position(2, 4),
				End:   position(2, 4),
			},
			position: position(2, 5), want: false,
		},
		{
			name: "non-empty start is inclusive",
			range_: protocol.Range{
				Start: position(2, 4),
				End:   position(2, 8),
			},
			position: position(2, 4), want: true,
		},
		{
			name: "non-empty end is exclusive",
			range_: protocol.Range{
				Start: position(2, 4),
				End:   position(2, 8),
			},
			position: position(2, 8), want: false,
		},
		{
			name: "multiline interior matches",
			range_: protocol.Range{
				Start: position(2, 4),
				End:   position(4, 3),
			},
			position: position(3, 99), want: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := rangeContainsPosition(test.range_, test.position); got != test.want {
				t.Fatalf("rangeContainsPosition(%#v, %#v) = %v, want %v", test.range_, test.position, got, test.want)
			}
		})
	}
}

func TestUTF16HoverBudgetDoesNotSplitRunes(t *testing.T) {
	t.Parallel()

	if got := utf16Units("a😀界"); got != 4 {
		t.Fatalf("UTF-16 units = %d, want 4", got)
	}
	if got := truncateUTF16("a😀b", 3); got != "a😀" {
		t.Fatalf("three-unit truncation = %q, want a😀", got)
	}
	if got := truncateUTF16("a😀b", 2); got != "a" {
		t.Fatalf("two-unit truncation = %q, want whole-rune a", got)
	}
}
