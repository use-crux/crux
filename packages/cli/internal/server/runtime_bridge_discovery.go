package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/cli/internal/runtimebridge"
)

const defaultBridgeEndpointPath = "/crux/bridge"

type runtimeBridgeManifest struct {
	Enabled      bool                       `json:"enabled"`
	Transport    runtimebridge.Transport    `json:"transport"`
	URL          string                     `json:"url,omitempty"`
	EndpointPath string                     `json:"endpointPath,omitempty"`
	RuntimeName  string                     `json:"runtimeName,omitempty"`
	Environment  string                     `json:"environment,omitempty"`
	Labels       map[string]string          `json:"labels,omitempty"`
	Capabilities []runtimebridge.Capability `json:"capabilities"`
}

func discoverRuntimeBridgePeers(ctx context.Context, bridge *runtimebridge.Service, projectRoot string) {
	if bridge == nil {
		return
	}
	for _, endpoint := range discoverRuntimeBridgeURLs(projectRoot) {
		if err := registerHTTPRuntimeBridgePeer(ctx, bridge, endpoint); err != nil {
			slog.Debug("runtime bridge HTTP peer discovery skipped", "url", endpoint, "error", err)
		}
	}
}

func registerHTTPRuntimeBridgePeer(ctx context.Context, bridge *runtimebridge.Service, endpoint string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("manifest returned HTTP %d", resp.StatusCode)
	}

	var manifest runtimeBridgeManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return err
	}
	if !manifest.Enabled {
		return fmt.Errorf("manifest disabled")
	}
	if manifest.Transport != "" && manifest.Transport != runtimebridge.TransportHTTP {
		return fmt.Errorf("manifest transport %q is not HTTP", manifest.Transport)
	}
	if len(manifest.Capabilities) == 0 {
		return fmt.Errorf("manifest has no capabilities")
	}
	peerURL := firstNonEmpty(manifest.URL, endpoint)
	bridge.RegisterPeer(runtimebridge.Peer{
		RuntimeName:  firstNonEmpty(manifest.RuntimeName, "crux-http-runtime"),
		Environment:  firstNonEmpty(manifest.Environment, "unknown"),
		Transport:    runtimebridge.TransportHTTP,
		EndpointURL:  peerURL,
		Labels:       manifest.Labels,
		Capabilities: manifest.Capabilities,
	}, nil)
	return nil
}

func discoverRuntimeBridgeURLs(projectRoot string) []string {
	values := readRuntimeBridgeEnv(projectRoot)
	var candidates []string
	if raw := values["CRUX_BRIDGE_URL"]; raw != "" {
		candidates = append(candidates, raw)
	}
	if raw := values["CONVEX_SITE_URL"]; raw != "" {
		candidates = append(candidates, joinBridgeEndpoint(raw))
	}
	for _, key := range []string{"CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"} {
		if raw := values[key]; raw != "" {
			if siteURL := convexCloudToSite(raw); siteURL != "" {
				candidates = append(candidates, joinBridgeEndpoint(siteURL))
			}
		}
	}
	return uniqueURLs(candidates)
}

func readRuntimeBridgeEnv(projectRoot string) map[string]string {
	values := map[string]string{}
	for _, env := range os.Environ() {
		key, value, ok := strings.Cut(env, "=")
		if ok {
			values[key] = value
		}
	}
	for _, path := range runtimeBridgeEnvFiles(projectRoot) {
		readEnvFile(path, values)
	}
	return values
}

func runtimeBridgeEnvFiles(projectRoot string) []string {
	if projectRoot == "" {
		if cwd, err := os.Getwd(); err == nil {
			projectRoot = cwd
		}
	}
	if projectRoot == "" {
		return nil
	}
	return []string{
		filepath.Join(projectRoot, ".env.local"),
		filepath.Join(projectRoot, ".env"),
	}
}

func readEnvFile(path string, values map[string]string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := values[key]; exists {
			continue
		}
		values[key] = cleanEnvValue(value)
	}
}

func cleanEnvValue(value string) string {
	value = strings.TrimSpace(value)
	if idx := strings.Index(value, " #"); idx >= 0 {
		value = strings.TrimSpace(value[:idx])
	}
	value = strings.Trim(value, `"'`)
	return value
}

func joinBridgeEndpoint(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return ""
	}
	if strings.HasSuffix(base, defaultBridgeEndpointPath) {
		return base
	}
	return base + defaultBridgeEndpointPath
}

func convexCloudToSite(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	if !strings.HasSuffix(parsed.Host, ".convex.cloud") {
		return ""
	}
	parsed.Host = strings.TrimSuffix(parsed.Host, ".convex.cloud") + ".convex.site"
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func uniqueURLs(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
