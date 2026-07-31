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
