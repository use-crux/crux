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
