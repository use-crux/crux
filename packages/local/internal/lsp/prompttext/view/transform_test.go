package view

import (
	"math"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestTransformRangeUsesFailClosedPromptTextBoundaries(t *testing.T) {
	target := testRange(2, 4, 2, 10)
	tests := []struct {
		name  string
		edit  protocol.Range
		text  string
		want  protocol.Range
		valid bool
	}{
		{
			name: "insertion before start shifts right",
			edit: testRange(2, 4, 2, 4), text: "xy",
			want: testRange(2, 6, 2, 12), valid: true,
		},
		{
			name: "replacement ending at start shifts",
			edit: testRange(1, 2, 2, 4), text: "x\n",
			want: testRange(2, 0, 2, 6), valid: true,
		},
		{
			name: "insertion at end is after",
			edit: testRange(2, 10, 2, 10), text: "xy",
			want: target, valid: true,
		},
		{
			name: "replacement after end is unchanged",
			edit: testRange(2, 10, 3, 1), text: "",
			want: target, valid: true,
		},
		{
			name: "interior insertion invalidates",
			edit: testRange(2, 7, 2, 7), text: "x",
		},
		{
			name: "overlap at start invalidates",
			edit: testRange(2, 2, 2, 5), text: "x",
		},
		{
			name: "overlap at end invalidates",
			edit: testRange(2, 9, 2, 12), text: "x",
		},
		{
			name: "covering replacement invalidates",
			edit: testRange(1, 0, 3, 0), text: "x",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, valid := transformRange(target, test.edit, test.text)
			if valid != test.valid || got != test.want {
				t.Fatalf("transform = %#v, %v; want %#v, %v", got, valid, test.want, test.valid)
			}
		})
	}
}

func TestTransformRangeRejectsPositionOverflow(t *testing.T) {
	tests := []struct {
		name   string
		target protocol.Range
		edit   protocol.Range
		text   string
	}{
		{
			name:   "line",
			target: testRange(math.MaxUint32, 0, math.MaxUint32, 0),
			edit:   testRange(0, 0, 0, 0),
			text:   "\n",
		},
		{
			name:   "character",
			target: testRange(2, math.MaxUint32, 2, math.MaxUint32),
			edit:   testRange(2, 0, 2, 0),
			text:   "x",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got, valid := transformRange(test.target, test.edit, test.text); valid {
				t.Fatalf("transform = %#v, true; want invalid", got)
			}
		})
	}
}

func testRange(startLine, startCharacter, endLine, endCharacter uint32) protocol.Range {
	return protocol.Range{
		Start: protocol.Position{Line: startLine, Character: startCharacter},
		End:   protocol.Position{Line: endLine, Character: endCharacter},
	}
}
