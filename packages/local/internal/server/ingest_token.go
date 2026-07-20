package server

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

const defaultIngestTokenPath = ".crux/devtools/ingest-token"

func loadOrCreateIngestToken(path string) (string, string, error) {
	return loadOrCreateIngestTokenWithLogger(path, slog.Default())
}

func loadOrCreateIngestTokenWithLogger(path string, logger *slog.Logger) (string, string, error) {
	if strings.TrimSpace(path) == "" {
		path = defaultIngestTokenPath
	}

	if raw, err := os.ReadFile(path); err == nil {
		token := strings.TrimSpace(string(raw))
		if token != "" {
			return token, path, nil
		}
	} else if !os.IsNotExist(err) {
		return "", path, fmt.Errorf("read ingest token: %w", err)
	}

	token := generateSessionToken(logger)
	if token == "" {
		return "", path, fmt.Errorf("generate ingest token")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", path, fmt.Errorf("create ingest token directory: %w", err)
	}
	if err := os.WriteFile(path, []byte(token+"\n"), 0o600); err != nil {
		return "", path, fmt.Errorf("write ingest token: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", path, fmt.Errorf("secure ingest token file: %w", err)
	}
	return token, path, nil
}
