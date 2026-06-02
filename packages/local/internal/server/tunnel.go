package server

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"golang.ngrok.com/ngrok/v2"
)

// TunnelResult holds the result of starting a tunnel.
type TunnelResult struct {
	URL      string
	Listener ngrok.EndpointListener
}

// Close stops the tunnel.
func (t *TunnelResult) Close() error {
	if t.Listener != nil {
		return t.Listener.Close()
	}
	return nil
}

// StartNgrokTunnel starts an ngrok tunnel using the ngrok-go SDK.
// Returns an EndpointListener that can be used directly with http.Serve —
// no TCP forwarding needed, the Go HTTP server handles tunnel connections directly.
// Reads NGROK_AUTHTOKEN from environment or .env/.env.local files.
func StartNgrokTunnel(ctx context.Context) (*TunnelResult, error) {
	// Load .env.local if NGROK_AUTHTOKEN isn't already set.
	if os.Getenv("NGROK_AUTHTOKEN") == "" {
		loadEnvFiles()
	}

	authtoken := os.Getenv("NGROK_AUTHTOKEN")
	if authtoken == "" {
		return nil, fmt.Errorf("NGROK_AUTHTOKEN not set. Get one from https://dashboard.ngrok.com")
	}

	slog.Info("starting ngrok tunnel")

	// Create agent with auth token.
	agent, err := ngrok.NewAgent(ngrok.WithAuthtoken(authtoken))
	if err != nil {
		return nil, fmt.Errorf("ngrok agent: %w", err)
	}

	// Listen — returns a net.Listener that accepts connections from ngrok's edge.
	// The Go HTTP server will serve these connections directly (no TCP forwarding).
	listener, err := agent.Listen(ctx)
	if err != nil {
		return nil, fmt.Errorf("ngrok listen: %w", err)
	}

	tunnelURL := listener.URL().String()
	slog.Info("ngrok tunnel started", "url", tunnelURL)

	return &TunnelResult{URL: tunnelURL, Listener: listener}, nil
}

// loadEnvFiles loads .env and .env.local files from cwd and parent dirs.
func loadEnvFiles() {
	dir, err := os.Getwd()
	if err != nil {
		return
	}

	for {
		for _, name := range []string{".env", ".env.local"} {
			loadSingleEnvFile(filepath.Join(dir, name))
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
}

func loadSingleEnvFile(envFile string) {
	f, err := os.Open(envFile)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
	if err := scanner.Err(); err != nil {
		slog.Debug("failed reading env file", "path", envFile, "error", err)
		return
	}
	slog.Debug("loaded env file", "path", envFile)
}
