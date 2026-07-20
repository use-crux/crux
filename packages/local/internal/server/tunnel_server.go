package server

import (
	"context"
	"errors"
	"net/http"
)

// StartTunnel starts the ngrok tunnel asynchronously.
// The tunnel listener serves the same HTTP handler as the local server —
// no TCP forwarding needed. When tunnel startup is enabled, it calls report
// once with the startup result. Returns immediately. Safe to call even if
// Tunnel is false (no-op).
func (d *DevServer) StartTunnel(ctx context.Context, report func(TunnelStartupResult)) {
	if !d.tunnel {
		return
	}

	d.workers.Go(func() {
		tunnelCtx, cancelTunnel := context.WithCancel(d.ctx)
		defer cancelTunnel()
		stopCallerCancellation := func() bool { return false }
		if ctx != nil {
			stopCallerCancellation = context.AfterFunc(ctx, cancelTunnel)
		}
		defer stopCallerCancellation()

		start := d.startTunnel
		if start == nil {
			start = startNgrokTunnel
		}
		result, err := start(tunnelCtx, d.logger)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				d.logger.Warn("tunnel failed to start", "error", err)
			}
			if report != nil {
				report(TunnelStartupResult{Err: err})
			}
			return
		}
		defer func() { _ = result.Close() }()
		// The tunnel is a public surface, so it is always gated by the session
		// token regardless of how the local listener is bound. The token is
		// carried invisibly in the URL we hand back to be opened/shared.
		authedURL := withSessionToken(result.URL, d.token)
		d.TunnelURL = authedURL

		// Serve the same HTTP handler on the tunnel listener via a separate http.Server,
		// wrapped with session auth. Tunnel requests are handled by the exact
		// same Go handler — no TCP proxy, no forwarding, no ERR_NGROK_3004.
		tunnelServer := &http.Server{Handler: requireSessionAuth(d.token, d.IngestToken, d.handler)}
		stopTunnelServer := context.AfterFunc(tunnelCtx, func() {
			_ = tunnelServer.Close()
			_ = result.Close()
		})
		defer stopTunnelServer()

		if report != nil {
			report(TunnelStartupResult{URL: authedURL})
		}
		d.logger.Info("serving tunnel traffic", "url", result.URL)
		if err := tunnelServer.Serve(result.Listener); err != nil && err != http.ErrServerClosed && tunnelCtx.Err() == nil {
			d.logger.Error("tunnel serve error", "error", err)
		}
	})
}
