package tui

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

func newTestApp(serverURL string, client DataClient, startupMode string, startupDebug bool) *App {
	return NewApp(context.Background(), serverURL, client, startupMode, startupDebug)
}

func newTestWorkbench(client screens.DataClient, rawClient DataClient, serverURL string) *Workbench {
	return NewWorkbench(context.Background(), client, rawClient, serverURL)
}
