package qualitycmd

import (
	"context"
	"slices"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestQualityCommandRegistersMCP(t *testing.T) {
	cmd := New(&cli.Factory{})
	if child, _, err := cmd.Find([]string{"mcp"}); err != nil || child == nil || child.Name() != "mcp" {
		t.Fatalf("quality command did not register mcp: child=%v err=%v", child, err)
	}
}

func TestQualityMCPRegistersPlannedTools(t *testing.T) {
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	server := newQualityMCPServer()
	errc := make(chan error, 1)
	go func() {
		errc <- server.Run(context.Background(), serverTransport)
	}()

	client := mcp.NewClient(&mcp.Implementation{Name: "quality-test"}, nil)
	session, err := client.Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(tools.Tools))
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	for _, want := range []string{"quality_list", "quality_run", "quality_show", "quality_diff", "quality_cell_evidence", "quality_judge_report", "quality_label"} {
		if !slices.Contains(names, want) {
			t.Fatalf("MCP tools = %v, missing %s", names, want)
		}
	}
}
