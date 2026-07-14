package projectindex

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDeploymentManifestContractMatchesTypeScriptGolden(t *testing.T) {
	artifact := readDeploymentManifestGolden(t)
	manifest, err := ParseDeploymentManifest(artifact)
	if err != nil {
		t.Fatalf("ParseDeploymentManifest() error = %v", err)
	}
	if err := VerifyDeploymentManifest(manifest); err != nil {
		t.Fatalf("VerifyDeploymentManifest() error = %v", err)
	}
	if got, want := manifest.ManifestID, "pim_2ef1edd97de11a9af98749673d3e44fb90e28bc8ae61df42d6b7ba26dbc52329"; got != want {
		t.Fatalf("ManifestID = %q, want %q", got, want)
	}
}

func TestDeploymentManifestContractRejectsInvalidArtifacts(t *testing.T) {
	golden := readDeploymentManifestGolden(t)
	tests := map[string][]byte{
		"unknown field": bytes.Replace(
			golden,
			[]byte(`"schemaVersion": 1,`),
			[]byte(`"schemaVersion": 1, "secret": "leak",`),
			1,
		),
		"absolute source": bytes.Replace(
			golden,
			[]byte(`"src/context.ts"`),
			[]byte(`"/private/context.ts"`),
			1,
		),
		"wrong digest": bytes.Replace(
			golden,
			[]byte("pim_2ef1edd97de11a9af98749673d3e44fb90e28bc8ae61df42d6b7ba26dbc52329"),
			[]byte("pim_3ef1edd97de11a9af98749673d3e44fb90e28bc8ae61df42d6b7ba26dbc52329"),
			1,
		),
	}

	for name, artifact := range tests {
		t.Run(name, func(t *testing.T) {
			manifest, err := ParseDeploymentManifest(artifact)
			if err == nil {
				err = VerifyDeploymentManifest(manifest)
			}
			if err == nil {
				t.Fatal("invalid artifact unexpectedly validated")
			}
		})
	}
}

func TestDeploymentManifestContractRejectsDriveRelativeSource(t *testing.T) {
	artifact := bytes.Replace(
		readDeploymentManifestGolden(t),
		[]byte(`"src/context.ts"`),
		[]byte(`"C:private/context.ts"`),
		1,
	)
	if _, err := ParseDeploymentManifest(artifact); err == nil {
		t.Fatal("drive-relative source unexpectedly parsed")
	}
}

func TestDeploymentManifestContractAcceptsTypeScriptValidEmptyName(t *testing.T) {
	artifact := bytes.Replace(
		readDeploymentManifestGolden(t),
		[]byte(`"name": "資料"`),
		[]byte(`"name": ""`),
		1,
	)
	if _, err := ParseDeploymentManifest(artifact); err != nil {
		t.Fatalf("TypeScript-valid empty definition name was rejected: %v", err)
	}
}

func TestDeploymentManifestContractMatchesTypeScriptUnicodeTrim(t *testing.T) {
	golden := readDeploymentManifestGolden(t)
	accepted := bytes.Replace(
		golden,
		[]byte(`"projectId": "manifest-fixture"`),
		[]byte("\"projectId\": \"\u0085manifest-fixture\u0085\""),
		1,
	)
	manifest, err := ParseDeploymentManifest(accepted)
	if err != nil {
		t.Fatalf("ECMAScript non-whitespace U+0085 was rejected: %v", err)
	}
	if err := VerifyDeploymentManifest(manifest); err != nil {
		t.Fatalf("verify U+0085 identity artifact: %v", err)
	}

	rejected := bytes.Replace(
		golden,
		[]byte(`"projectId": "manifest-fixture"`),
		[]byte("\"projectId\": \"\ufeffmanifest-fixture\ufeff\""),
		1,
	)
	if _, err := ParseDeploymentManifest(rejected); err == nil {
		t.Fatal("ECMAScript whitespace U+FEFF unexpectedly parsed")
	}
}

func readDeploymentManifestGolden(t *testing.T) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("determine manifest contract test path")
	}
	path := filepath.Join(
		filepath.Dir(filename),
		"..", "..", "..", "..",
		"packages", "indexer", "__tests__", "fixtures",
		"deployment-manifest-project", "manifest.golden.json",
	)
	artifact, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read TypeScript manifest golden: %v", err)
	}
	return artifact
}
