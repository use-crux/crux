package tui

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type realProgramSmokeModel struct {
	initialized bool
	key         string
}

func (m *realProgramSmokeModel) Init() tea.Cmd {
	m.initialized = true
	return nil
}

func (m *realProgramSmokeModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if key, ok := msg.(tea.KeyPressMsg); ok {
		m.key = key.String()
		return m, tea.Quit
	}
	return m, nil
}

func (m *realProgramSmokeModel) View() tea.View {
	return tea.NewView("program ready")
}

func TestRealProgramHarnessBootsAndExits(t *testing.T) {
	final, output, err := runTestProgram(t, &realProgramSmokeModel{}, "x")
	if err != nil {
		t.Fatalf("run real program: %v", err)
	}

	model, ok := final.(*realProgramSmokeModel)
	if !ok {
		t.Fatalf("final model type = %T, want *realProgramSmokeModel", final)
	}
	if !model.initialized {
		t.Fatal("program did not initialize model")
	}
	if model.key != "x" {
		t.Fatalf("program key = %q, want controlled input %q", model.key, "x")
	}
	if !strings.Contains(output, "program ready") {
		t.Fatalf("program output = %q, want rendered view", output)
	}
}

type slowIndexFixtureClient struct {
	*uitest.FixtureClient
	indexData       api.IndexData
	projectStarted  chan struct{}
	projectRelease  chan struct{}
	activityStarted chan struct{}
	activityRelease chan struct{}
	projectOnce     sync.Once
	activityOnce    sync.Once
	projectCalls    atomic.Int32
}

func newSlowIndexFixtureClient() *slowIndexFixtureClient {
	definitions := make([]api.ProjectDefinition, 713)
	for index := range definitions {
		definitions[index] = api.ProjectDefinition{
			ID:   fmt.Sprintf("prompt:slow-refresh-%03d", index),
			Kind: "prompt",
			Name: fmt.Sprintf("slow refresh %03d", index),
		}
	}
	data := api.IndexData{Definitions: definitions}
	return &slowIndexFixtureClient{
		FixtureClient:   uitest.NewFixtureClient(),
		indexData:       data,
		projectStarted:  make(chan struct{}),
		projectRelease:  make(chan struct{}),
		activityStarted: make(chan struct{}),
		activityRelease: make(chan struct{}),
	}
}

func (c *slowIndexFixtureClient) ProjectIndex(ctx context.Context) (api.IndexData, error) {
	c.projectCalls.Add(1)
	c.projectOnce.Do(func() { close(c.projectStarted) })
	select {
	case <-c.projectRelease:
		return c.indexData, nil
	case <-ctx.Done():
		return api.IndexData{}, ctx.Err()
	}
}

func (c *slowIndexFixtureClient) DefinitionActivity(ctx context.Context, definitionID string) (api.CatalogRuntimeActivityV1, error) {
	c.activityOnce.Do(func() { close(c.activityStarted) })
	select {
	case <-c.activityRelease:
		return api.CatalogRuntimeActivityV1{DefinitionID: definitionID}, nil
	case <-ctx.Done():
		return api.CatalogRuntimeActivityV1{}, ctx.Err()
	}
}

func runSlowIndexApp(t *testing.T, client *slowIndexFixtureClient) (*App, *io.PipeWriter, <-chan shutdownProgramResult) {
	t.Helper()
	app := NewApp(t.Context(), "http://localhost:5501", client, "", false)
	app.MarkBootComplete()
	app.workbench.screens["index"].(*screens.Index).SetIndexForTest(client.indexData)

	input, writer := io.Pipe()
	program := tea.NewProgram(
		app,
		tea.WithInput(input),
		tea.WithOutput(io.Discard),
		tea.WithEnvironment([]string{"NO_COLOR=1", "TERM=dumb"}),
		tea.WithWindowSize(100, 30),
		tea.WithoutSignalHandler(),
	)
	app.SetProgram(program)
	done := make(chan shutdownProgramResult, 1)
	go func() {
		model, err := program.Run()
		done <- shutdownProgramResult{model: model, err: err}
	}()
	return app, writer, done
}

func writeProgramKey(t *testing.T, writer io.Writer, key string) {
	t.Helper()
	if _, err := io.WriteString(writer, key); err != nil {
		t.Fatalf("write program key %q: %v", key, err)
	}
	time.Sleep(10 * time.Millisecond)
}

func awaitProgramExit(t *testing.T, done <-chan shutdownProgramResult) {
	t.Helper()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("run program: %v", result.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("program did not process q while Index data work was blocked")
	}
}

func TestRealProgramProcessesKeysDuringSlowIndexRefreshes(t *testing.T) {
	t.Run("project index", func(t *testing.T) {
		client := newSlowIndexFixtureClient()
		app, input, done := runSlowIndexApp(t, client)
		defer input.Close()
		defer close(client.projectRelease)
		defer close(client.activityRelease)

		writeProgramKey(t, input, "5")
		app.SendMsg(bridge.Batch{Changed: bridge.NewDomains(bridge.DomainIndex), Revs: bridge.Revisions{Index: 1}})
		select {
		case <-client.projectStarted:
		case <-time.After(time.Second):
			t.Fatal("slow ProjectIndex refresh did not start")
		}
		for revision := uint64(2); revision <= 8; revision++ {
			app.SendMsg(bridge.Batch{Changed: bridge.NewDomains(bridge.DomainIndex), Revs: bridge.Revisions{Index: revision}})
		}
		writeProgramKey(t, input, "v")
		writeProgramKey(t, input, "1")
		writeProgramKey(t, input, "q")
		awaitProgramExit(t, done)

		if calls := client.projectCalls.Load(); calls != 1 {
			t.Fatalf("blocked ProjectIndex calls = %d, want one coalesced active request", calls)
		}
		if app.workbench.activeNav != "overview" {
			t.Fatalf("screen switch during refresh ended on %q, want overview", app.workbench.activeNav)
		}
		indexView := ansi.Strip(app.workbench.screens["index"].View(screens.Size{Width: 80, Height: 24}))
		if !strings.Contains(indexView, "OTHER 713") {
			t.Fatalf("v was not processed during refresh:\n%s", indexView)
		}
	})

	t.Run("definition activity", func(t *testing.T) {
		client := newSlowIndexFixtureClient()
		close(client.projectRelease)
		app, input, done := runSlowIndexApp(t, client)
		defer input.Close()
		defer close(client.activityRelease)

		writeProgramKey(t, input, "5")
		app.SendMsg(bridge.Batch{Changed: bridge.NewDomains(bridge.DomainIndex), Revs: bridge.Revisions{Index: 1}})
		select {
		case <-client.activityStarted:
		case <-time.After(time.Second):
			t.Fatal("slow DefinitionActivity refresh did not start")
		}
		writeProgramKey(t, input, "!")
		writeProgramKey(t, input, "1")
		writeProgramKey(t, input, "q")
		awaitProgramExit(t, done)

		if app.workbench.activeNav != "overview" {
			t.Fatalf("screen switch during activity refresh ended on %q, want overview", app.workbench.activeNav)
		}
		if app.workbench.statusToast != "no startup issues" {
			t.Fatalf("! during activity refresh set status %q", app.workbench.statusToast)
		}
	})
}
