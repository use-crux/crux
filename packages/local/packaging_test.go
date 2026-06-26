package local_test

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type platformBundle struct {
	name         string
	cruxBinary   string
	workerBinary string
}

func TestMakeAllPackagesIndexerWorkerBesideCrux(t *testing.T) {
	makePath, err := exec.LookPath("make")
	if err != nil {
		t.Skip("make is required to verify platform packaging")
	}

	cmd := exec.Command(makePath, "-n", "all", "VERSION=test")
	cmd.Dir = "."

	outputBytes, err := cmd.CombinedOutput()
	output := string(outputBytes)
	if err != nil {
		t.Fatalf("dry-run make all: %v\n%s", err, output)
	}

	for _, bundle := range supportedPlatformBundles() {
		assertDryRunPackages(t, output, bundle)
	}
}

func TestLocalAllToolchainPreflightReportsMissingRustTargets(t *testing.T) {
	makePath, err := exec.LookPath("make")
	if err != nil {
		t.Skip("make is required to verify platform packaging")
	}

	const missingTarget = "crux-test-missing-target"
	cmd := exec.Command(
		makePath,
		"check-local-all-toolchain",
		"LOCAL_ALL_RUST_TARGETS="+missingTarget,
		"LOCAL_ALL_REQUIRED_TOOLS=make",
		"LOCAL_ALL_REQUIRED_LINKERS=",
		"LOCAL_ALL_DARWIN_CROSS_OK=1",
	)
	cmd.Dir = "."

	outputBytes, err := cmd.CombinedOutput()
	output := string(outputBytes)
	if err == nil {
		t.Fatalf("preflight passed with missing Rust target; output:\n%s", output)
	}
	if !strings.Contains(output, "rustup target add "+missingTarget) {
		t.Fatalf("preflight output did not include install command for %s:\n%s", missingTarget, output)
	}
}

func TestLocalAllToolchainPreflightReportsMissingCrossLinkers(t *testing.T) {
	makePath, err := exec.LookPath("make")
	if err != nil {
		t.Skip("make is required to verify platform packaging")
	}

	const missingLinker = "crux-test-missing-linker"
	cmd := exec.Command(
		makePath,
		"check-local-all-toolchain",
		"LOCAL_ALL_RUST_TARGETS=x86_64-unknown-linux-gnu",
		"LOCAL_ALL_REQUIRED_TOOLS=make",
		"LOCAL_ALL_REQUIRED_LINKERS="+missingLinker,
		"LOCAL_ALL_DARWIN_CROSS_OK=1",
	)
	cmd.Dir = "."

	outputBytes, err := cmd.CombinedOutput()
	output := string(outputBytes)
	if err == nil {
		t.Fatalf("preflight passed with missing cross linker; output:\n%s", output)
	}
	if !strings.Contains(output, "Missing cross linker for make local-all: "+missingLinker) {
		t.Fatalf("preflight output did not include missing linker %s:\n%s", missingLinker, output)
	}
}

func supportedPlatformBundles() []platformBundle {
	return []platformBundle{
		{name: "linux-x64", cruxBinary: "crux", workerBinary: "crux-indexer-worker"},
		{name: "linux-arm64", cruxBinary: "crux", workerBinary: "crux-indexer-worker"},
		{name: "darwin-x64", cruxBinary: "crux", workerBinary: "crux-indexer-worker"},
		{name: "darwin-arm64", cruxBinary: "crux", workerBinary: "crux-indexer-worker"},
		{name: "win32-x64", cruxBinary: "crux.exe", workerBinary: "crux-indexer-worker.exe"},
		{name: "win32-arm64", cruxBinary: "crux.exe", workerBinary: "crux-indexer-worker.exe"},
	}
}

func assertDryRunPackages(t *testing.T, output string, bundle platformBundle) {
	t.Helper()

	distBin := filepath.ToSlash(filepath.Join("dist", "crux-"+bundle.name, "bin"))
	for _, binary := range []string{bundle.cruxBinary, bundle.workerBinary} {
		expected := filepath.ToSlash(filepath.Join(distBin, binary))
		if !strings.Contains(output, expected) {
			t.Fatalf("make all dry-run did not package %s; output:\n%s", expected, output)
		}
	}
}
