package jsonrpc

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestReaderReadsConsecutiveGoldenFrames(t *testing.T) {
	t.Parallel()

	input := readGolden(t, "frames.input")
	reader := NewReader(bytes.NewReader(input))

	first, err := reader.Read()
	if err != nil {
		t.Fatalf("read first frame: %v", err)
	}
	second, err := reader.Read()
	if err != nil {
		t.Fatalf("read second frame: %v", err)
	}
	if _, err := reader.Read(); err != io.EOF {
		t.Fatalf("read after frames = %v, want EOF", err)
	}

	wantFirst := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	wantSecond := []byte(`{"jsonrpc":"2.0","method":"initialized","params":{}}`)
	if !bytes.Equal(first, wantFirst) {
		t.Fatalf("first payload = %s, want %s", first, wantFirst)
	}
	if !bytes.Equal(second, wantSecond) {
		t.Fatalf("second payload = %s, want %s", second, wantSecond)
	}
}

func TestWriterMatchesGoldenFrame(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	writer := NewWriter(&output)
	if err := writer.Write([]byte(`{"jsonrpc":"2.0","id":"request-1","result":null}`)); err != nil {
		t.Fatalf("write frame: %v", err)
	}

	want := readGolden(t, "response.output")
	if !bytes.Equal(output.Bytes(), want) {
		t.Fatalf("frame mismatch\n--- got ---\n%q\n--- want ---\n%q", output.Bytes(), want)
	}
}

func readGolden(t *testing.T, name string) []byte {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read golden %s: %v", name, err)
	}
	decoded, err := strconv.Unquote(strings.TrimSpace(string(content)))
	if err != nil {
		t.Fatalf("decode golden %s: %v", name, err)
	}
	return []byte(decoded)
}
