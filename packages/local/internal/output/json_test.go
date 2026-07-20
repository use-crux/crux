package output

import (
	"bytes"
	"errors"
	"testing"
)

type jsonFailingWriter struct {
	err error
}

func (w jsonFailingWriter) Write([]byte) (int, error) {
	return 0, w.err
}

func TestIOWriteJSONUsesInjectedWriter(t *testing.T) {
	var out bytes.Buffer
	streams := NewTestIO(&out, &bytes.Buffer{}, TestIOOptions{})

	if err := streams.WriteJSON(struct {
		Name string `json:"name"`
	}{Name: "crux"}); err != nil {
		t.Fatalf("WriteJSON() error = %v", err)
	}

	if got, want := out.String(), "{\n  \"name\": \"crux\"\n}\n"; got != want {
		t.Fatalf("WriteJSON() output = %q, want %q", got, want)
	}
}

func TestIOWriteJSONReturnsInjectedWriterError(t *testing.T) {
	want := errors.New("write failed")
	streams := NewTestIO(jsonFailingWriter{err: want}, &bytes.Buffer{}, TestIOOptions{})

	err := streams.WriteJSON(map[string]string{"name": "crux"})
	if !errors.Is(err, want) {
		t.Fatalf("WriteJSON() error = %v, want errors.Is(_, %v)", err, want)
	}
}
