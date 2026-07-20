package commands

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/server"
)

// devServerSession is the command-owned lifecycle boundary around the native
// dev server. Tests replace this external boundary without opening listeners.
type devServerSession interface {
	Start() error
	Shutdown(context.Context) error
	LocalGated() bool
	LocalURL() string
	StartTunnel(context.Context, func(server.TunnelStartupResult))
	IngestCredentials() (token string, path string)
	Native() *server.DevServer
}

type nativeDevServerSession struct {
	server *server.DevServer
}

func (session *nativeDevServerSession) Start() error {
	return session.server.Start()
}

func (session *nativeDevServerSession) Shutdown(ctx context.Context) error {
	return session.server.Shutdown(ctx)
}

func (session *nativeDevServerSession) LocalGated() bool {
	return session.server.LocalGated()
}

func (session *nativeDevServerSession) LocalURL() string {
	return session.server.LocalURL()
}

func (session *nativeDevServerSession) StartTunnel(ctx context.Context, report func(server.TunnelStartupResult)) {
	session.server.StartTunnel(ctx, report)
}

func (session *nativeDevServerSession) IngestCredentials() (string, string) {
	return session.server.IngestToken, session.server.IngestTokenPath
}

func (session *nativeDevServerSession) Native() *server.DevServer {
	return session.server
}
