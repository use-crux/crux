package output

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// WriteJSON writes data as indented JSON to the primary injected output
// stream. Encoding and write failures are returned to the command boundary.
func (io *IO) WriteJSON(data any) error {
	return writeJSON(io.Out, data)
}

// JSONToFile writes data as pretty-printed JSON to a file.
func JSONToFile(data any, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create %s: %w", path, err)
	}
	defer f.Close()
	return writeJSON(f, data)
}

func writeJSON(writer io.Writer, data any) error {
	enc := json.NewEncoder(writer)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
}
