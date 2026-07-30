package kit

import "testing"

func TestPluralize(t *testing.T) {
	for _, test := range []struct {
		count int
		want  string
	}{
		{count: 0, want: "runs"},
		{count: 1, want: "run"},
		{count: 2, want: "runs"},
	} {
		if got := Pluralize(test.count, "run"); got != test.want {
			t.Errorf("Pluralize(%d, run) = %q, want %q", test.count, got, test.want)
		}
	}
}
