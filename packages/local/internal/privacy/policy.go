// Package privacy loads the generated, data-only project persistence policy.
package privacy

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"
)

const snapshotRelativePath = ".crux/generated/runtime/privacy.json"

const PolicyUnavailableMessage = "Project privacy policy is not ready; run crux runtime generate, then retry."

var ErrPolicyUnavailable = errors.New("project privacy policy unavailable")

var fingerprintPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Policy is the normalized project persistence policy used by local writers.
type Policy struct {
	RedactPaths []string
}

// Provider resolves the current generated policy at a durable write boundary.
type Provider interface {
	Current() (Policy, error)
}

type generatedProvider struct{ root string }

// Generated reads the privacy snapshot written by crux runtime generate.
func Generated(projectRoot string) Provider {
	return generatedProvider{root: projectRoot}
}

// Static supplies a validated policy to tests and embedded integrations.
func Static(redactPaths ...string) Provider {
	return staticProvider{paths: append([]string(nil), redactPaths...)}
}

type staticProvider struct{ paths []string }

func (p staticProvider) Current() (Policy, error) { return normalize(p.paths) }

func (p generatedProvider) Current() (Policy, error) {
	if strings.TrimSpace(p.root) == "" {
		return Policy{RedactPaths: []string{}}, nil
	}
	content, err := os.ReadFile(filepath.Join(p.root, snapshotRelativePath))
	if errors.Is(err, os.ErrNotExist) {
		return Policy{}, unavailable("generated snapshot is missing")
	}
	if err != nil {
		return Policy{}, unavailable(fmt.Sprintf("read generated snapshot: %v", err))
	}
	var snapshot struct {
		SchemaVersion      int      `json:"schemaVersion"`
		PrivacyFingerprint string   `json:"privacyFingerprint"`
		RedactPaths        []string `json:"redactPaths"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil || snapshot.SchemaVersion != 1 || !fingerprintPattern.MatchString(snapshot.PrivacyFingerprint) {
		return Policy{}, unavailable("generated snapshot is invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Policy{}, unavailable("generated snapshot is invalid")
	}
	policy, err := normalize(snapshot.RedactPaths)
	if err != nil || fingerprint(policy) != snapshot.PrivacyFingerprint {
		return Policy{}, unavailable("generated snapshot is stale or invalid")
	}
	return policy, nil
}

// InvalidateGenerated makes writes fail closed while artifacts are refreshed.
func InvalidateGenerated(projectRoot string) error {
	if strings.TrimSpace(projectRoot) == "" {
		return nil
	}
	err := os.Remove(filepath.Join(projectRoot, snapshotRelativePath))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("invalidate generated privacy policy: %w", err)
	}
	return nil
}

func unavailable(detail string) error {
	return fmt.Errorf("%w: %s %s", ErrPolicyUnavailable, detail, PolicyUnavailableMessage)
}

func normalize(paths []string) (Policy, error) {
	unique := make(map[string]struct{}, len(paths))
	for _, raw := range paths {
		path := strings.TrimSpace(raw)
		if path == "" || len(path) > 512 || strings.Contains(path, "..") {
			return Policy{}, fmt.Errorf("observability.redactPaths contains an invalid dot path")
		}
		for _, segment := range strings.Split(path, ".") {
			if segment == "" || strings.IndexFunc(segment, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
				return Policy{}, fmt.Errorf("observability.redactPaths contains an invalid dot path")
			}
		}
		unique[path] = struct{}{}
	}
	normalized := make([]string, 0, len(unique))
	for path := range unique {
		normalized = append(normalized, path)
	}
	sort.Slice(normalized, func(i, j int) bool {
		return utf16Less(normalized[i], normalized[j])
	})
	return Policy{RedactPaths: normalized}, nil
}

func fingerprint(policy Policy) string {
	entries := make([]any, 0, len(policy.RedactPaths))
	for _, path := range policy.RedactPaths {
		entries = append(entries, []any{"string", path})
	}
	encoded := []any{"object", []any{
		[]any{"redactPaths", []any{"array", entries, []any{}}},
		[]any{"schemaVersion", []any{"number", 1}},
	}}
	var canonical bytes.Buffer
	encoder := json.NewEncoder(&canonical)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(encoded)
	content := bytes.TrimSuffix(canonical.Bytes(), []byte("\n"))
	return fmt.Sprintf("%x", sha256.Sum256(content))
}

func utf16Less(left, right string) bool {
	a := utf16.Encode([]rune(left))
	b := utf16.Encode([]rune(right))
	for index := 0; index < len(a) && index < len(b); index++ {
		if a[index] != b[index] {
			return a[index] < b[index]
		}
	}
	return len(a) < len(b)
}
