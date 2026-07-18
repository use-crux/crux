package privacy

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestGeneratedProviderReadsCanonicalPrivacySnapshot(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".crux", "generated", "runtime", "privacy.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{
  "schemaVersion": 1,
  "privacyFingerprint": "5eb3440f35da9ffc289e4765ff43e1e1f97954f71a2b929de210e5e836bca326",
  "redactPaths": [" customer.email ", "customer.email", "profile.token", "a<b", "\uE000.value", "\uD83D\uDE00.value"]
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	policy, err := Generated(root).Current()
	if err != nil {
		t.Fatalf("Current: %v", err)
	}
	if !reflect.DeepEqual(policy.RedactPaths, []string{"a<b", "customer.email", "profile.token", "\U0001F600.value", "\uE000.value"}) {
		t.Fatalf("redact paths = %#v", policy.RedactPaths)
	}
}

func TestGeneratedProviderFailsClosedOnInvalidSnapshot(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".crux", "generated", "runtime", "privacy.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"privacyFingerprint":"not-a-hash","redactPaths":["customer..email"]}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := Generated(root).Current(); err == nil {
		t.Fatal("Current succeeded with an invalid generated privacy snapshot")
	}
}

func TestGeneratedProviderFailsClosedBeforeGeneration(t *testing.T) {
	if _, err := Generated(t.TempDir()).Current(); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("Current error = %v, want ErrPolicyUnavailable", err)
	}
}
