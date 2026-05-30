package output

import (
	"encoding/json"
	"fmt"
	"os"
)

// JSON prints data as pretty-printed JSON to stdout.
func JSON(data any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
}

// JSONToFile writes data as pretty-printed JSON to a file.
func JSONToFile(data any, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create %s: %w", path, err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
}
