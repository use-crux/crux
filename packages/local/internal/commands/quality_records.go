package commands

// --json / --json-out artifact writers for `crux quality run` (spec 02 §1,
// spec 03 §2): concatenate the persisted Experiment record(s) produced by the
// worker into one JSON array, emitted either to a writer (--json → stdout) or a
// file path (--json-out). The flag split keeps `--json` a bool consistent with
// every other quality subcommand.

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// renderQualityRecords reads each persisted record and concatenates them into a
// single pretty-printed JSON array (the byte-stable artifact both writers emit).
func renderQualityRecords(recordPaths []string) ([]byte, error) {
	records := make([]json.RawMessage, 0, len(recordPaths))
	for _, recordPath := range recordPaths {
		data, err := os.ReadFile(recordPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read record %s: %w", recordPath, err)
		}
		records = append(records, json.RawMessage(data))
	}
	return json.MarshalIndent(records, "", "  ")
}

// writeQualityRecordsToWriter writes the record array to w with a trailing
// newline (the `--json` → stdout path).
func writeQualityRecordsToWriter(w io.Writer, recordPaths []string) error {
	out, err := renderQualityRecords(recordPaths)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(w, string(out))
	return err
}

// writeQualityRecordsToFile writes the record array to a file path with a
// trailing newline (the `--json-out <path>` behavior).
func writeQualityRecordsToFile(path string, recordPaths []string) error {
	out, err := renderQualityRecords(recordPaths)
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(out, '\n'), 0o644)
}
