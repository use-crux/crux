// Package jsonrpc implements JSON-RPC transport over LSP's Content-Length
// framing. It deliberately has no knowledge of LSP methods or payload types.
package jsonrpc

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

const maxContentLength = 64 << 20

// FrameError reports an invalid LSP transport header.
type FrameError struct {
	Message string
}

func (e *FrameError) Error() string { return e.Message }

// Reader reads consecutive Content-Length-framed JSON-RPC payloads.
type Reader struct {
	input *bufio.Reader
}

// NewReader creates a framed reader over input.
func NewReader(input io.Reader) *Reader {
	return &Reader{input: bufio.NewReader(input)}
}

// Read returns the next JSON payload without its transport headers.
func (r *Reader) Read() ([]byte, error) {
	contentLength := -1
	sawHeader := false
	for {
		line, err := r.input.ReadString('\n')
		if err != nil && len(line) == 0 {
			if errors.Is(err, io.EOF) && !sawHeader {
				return nil, io.EOF
			}
			return nil, err
		}
		sawHeader = true
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			break
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			return nil, &FrameError{Message: fmt.Sprintf("malformed LSP header %q", line)}
		}
		switch strings.ToLower(strings.TrimSpace(name)) {
		case "content-length":
			length, parseErr := strconv.Atoi(strings.TrimSpace(value))
			if parseErr != nil || length < 0 || length > maxContentLength {
				return nil, &FrameError{Message: fmt.Sprintf("invalid Content-Length %q", strings.TrimSpace(value))}
			}
			contentLength = length
		case "content-type":
			// Optional per LSP; the JSON decoder validates the body itself.
		default:
			return nil, &FrameError{Message: fmt.Sprintf("unsupported LSP header %q", strings.TrimSpace(name))}
		}
		if err != nil {
			return nil, err
		}
	}
	if contentLength < 0 {
		return nil, &FrameError{Message: "missing Content-Length header"}
	}
	payload := make([]byte, contentLength)
	if _, err := io.ReadFull(r.input, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

// Writer emits byte-exact Content-Length-framed JSON-RPC payloads.
// Callers must serialize access through one goroutine.
type Writer struct {
	output io.Writer
}

// NewWriter creates a framed writer over output.
func NewWriter(output io.Writer) *Writer {
	return &Writer{output: output}
}

// Write writes one complete frame.
func (w *Writer) Write(payload []byte) error {
	buffer := bufio.NewWriter(w.output)
	if _, err := fmt.Fprintf(buffer, "Content-Length: %d\r\n\r\n", len(payload)); err != nil {
		return err
	}
	if _, err := buffer.Write(payload); err != nil {
		return err
	}
	return buffer.Flush()
}
