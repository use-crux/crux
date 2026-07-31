package uitest

import (
	"reflect"
	"testing"
)

func TestBackgroundSpansTracksNestedResetsExactly(t *testing.T) {
	row := "\x1b[48;2;16;22;20mab\x1b[31mc\x1b[m\x1b[48;2;16;22;20md\x1b[m "
	want := []BackgroundSpan{
		{Start: 0, End: 4, Color: "rgb:16,22,20"},
		{Start: 4, End: 5, Color: ""},
	}
	if got := BackgroundSpans(row); !reflect.DeepEqual(got, want) {
		t.Fatalf("BackgroundSpans() = %#v, want %#v", got, want)
	}
}

func TestCellStylesTracksForegroundAndBackgroundResets(t *testing.T) {
	row := "\x1b[38;2;42;53;47;48;2;11;15;14ma\x1b[39mb\x1b[38;5;238;48;5;234mc\x1b[0md"
	want := []CellStyle{
		{Foreground: "rgb:42,53,47", Background: "rgb:11,15,14"},
		{Background: "rgb:11,15,14"},
		{Foreground: "index:238", Background: "index:234"},
		{},
	}
	if got := CellStyles(row); !reflect.DeepEqual(got, want) {
		t.Fatalf("CellStyles() = %#v, want %#v", got, want)
	}
}
