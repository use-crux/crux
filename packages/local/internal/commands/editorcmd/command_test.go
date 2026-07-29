package editorcmd

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestInstallCommandUsesRootVersionAndExplicitCursorTarget(t *testing.T) {
	var received installRequest
	var stdout, stderr bytes.Buffer
	factory := cli.NewFactoryWithStreams(
		output.NewTestIO(&stdout, &stderr, output.TestIOOptions{}),
	)
	root := &cobra.Command{Use: "crux", Version: "1.2.3"}
	root.AddCommand(newCommand(factory, func(
		_ context.Context,
		request installRequest,
	) (installResult, error) {
		received = request
		return installResult{}, nil
	}))
	root.SetArgs([]string{"editor", "install", "cursor"})

	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if received.version != "1.2.3" || received.editor != editorCursor {
		t.Fatalf("request = %#v", received)
	}
	if stdout.String() != "Installed Crux 1.2.3 for Cursor.\n" {
		t.Fatalf("stdout = %q", stdout.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestInstallCommandReportsDownloadOnlyDestination(t *testing.T) {
	var received installRequest
	var stdout, stderr bytes.Buffer
	factory := cli.NewFactoryWithStreams(
		output.NewTestIO(&stdout, &stderr, output.TestIOOptions{}),
	)
	root := &cobra.Command{Use: "crux", Version: "1.2.3"}
	root.AddCommand(newCommand(factory, func(
		_ context.Context,
		request installRequest,
	) (installResult, error) {
		received = request
		return installResult{outputPath: "/tmp/crux-vscode-1.2.3.vsix"}, nil
	}))
	root.SetArgs([]string{
		"editor", "install", "vscode", "--download-only", "artifacts",
	})

	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if received.downloadDir != "artifacts" {
		t.Fatalf("download directory = %q", received.downloadDir)
	}
	if stdout.String() != "Downloaded verified Crux 1.2.3 extension to /tmp/crux-vscode-1.2.3.vsix.\n" {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

func TestInstallCommandRejectsUnpublishedDevelopmentVersion(t *testing.T) {
	factory := cli.NewFactoryWithStreams(
		output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{}),
	)
	root := &cobra.Command{Use: "crux", Version: "dev"}
	root.AddCommand(newCommand(factory, func(
		context.Context,
		installRequest,
	) (installResult, error) {
		t.Fatal("development version reached the installer")
		return installResult{}, nil
	}))
	root.SetArgs([]string{"editor", "install", "vscode"})

	err := root.Execute()
	if err == nil || !strings.Contains(err.Error(), "does not identify a published GitHub Release") {
		t.Fatalf("error = %v", err)
	}
}
