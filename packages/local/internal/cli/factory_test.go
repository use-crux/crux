package cli

import (
	"bytes"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestNewFactoryWithStreamsReturnsInjectedIO(t *testing.T) {
	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})
	factory := NewFactoryWithStreams(streams)

	if got := factory.Streams(); got != streams {
		t.Fatalf("Streams() = %p, want injected %p", got, streams)
	}
}

func TestJSONOutputCombinesGlobalAndLocalFlags(t *testing.T) {
	for _, test := range []struct {
		global bool
		local  bool
		want   bool
	}{
		{},
		{local: true, want: true},
		{global: true, want: true},
		{global: true, local: true, want: true},
	} {
		factory := &Factory{JSON: test.global}
		if got := factory.JSONOutput(test.local); got != test.want {
			t.Fatalf("JSONOutput(%t) with global %t = %t, want %t", test.local, test.global, got, test.want)
		}
	}
}
