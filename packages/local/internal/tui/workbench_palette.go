package tui

import (
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/overlays"
)

func timeNowMs() int64 { return time.Now().UnixMilli() }

// runPaletteCommand dispatches a parsed palette command to an executable
// workspace or client capability.
func (w *Workbench) runPaletteCommand(chosen overlays.Chosen) tea.Cmd {
	switch chosen.Verb {
	case "quit", "q", "exit":
		if w.requestShutdown != nil {
			return w.requestShutdown()
		}
		return nil
	case "goto", "g":
		if len(chosen.Args) == 0 {
			return w.toast("goto: missing screen name")
		}
		return w.gotoNav(chosen.Args[0])
	case "dismiss":
		id := ""
		if len(chosen.Args) >= 2 && chosen.Args[0] == "insight" {
			id = chosen.Args[1]
		} else if len(chosen.Args) >= 1 {
			id = chosen.Args[0]
		} else {
			return w.toast("usage: dismiss insight <ID>")
		}
		client, ctx := w.client, w.ctx
		return func() tea.Msg {
			_, err := client.SetInsightStatus(ctx, id, api.InspectInsightStatusRequest{Status: "dismissed"})
			if err != nil {
				return paletteResultMsg{Err: err.Error()}
			}
			return paletteResultMsg{OK: "dismissed " + id}
		}
	default:
		return w.toast("unknown command: " + chosen.Verb)
	}
}

type paletteResultMsg struct {
	OK  string
	Err string
}

func (w *Workbench) toast(value string) tea.Cmd {
	return func() tea.Msg { return paletteResultMsg{OK: value} }
}
