package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/use-crux/crux/packages/cli/internal/runtimebridge"
)

func handleRuntimeBridgeUpgrade(bridge *runtimebridge.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if bridge == nil {
			http.Error(w, "runtime bridge unavailable", http.StatusServiceUnavailable)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Error("runtime bridge websocket upgrade failed", "error", err)
			return
		}

		_, helloData, err := conn.ReadMessage()
		if err != nil {
			_ = conn.Close()
			return
		}
		var hello runtimebridge.RuntimeHello
		if err := json.Unmarshal(helloData, &hello); err != nil || hello.Type != "runtime.hello" {
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseUnsupportedData, "runtime.hello required"))
			_ = conn.Close()
			return
		}

		var writeMu sync.Mutex
		peer := bridge.RegisterPeer(hello.Peer, func(ctx context.Context, data []byte) error {
			done := make(chan error, 1)
			go func() {
				writeMu.Lock()
				defer writeMu.Unlock()
				done <- conn.WriteMessage(websocket.TextMessage, data)
			}()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case err := <-done:
				return err
			}
		})
		defer func() {
			bridge.UnregisterPeer(peer.PeerID)
			_ = conn.Close()
		}()

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := bridge.HandlePeerMessage(peer.PeerID, data); err != nil {
				slog.Debug("runtime bridge message ignored", "error", err, "peerId", peer.PeerID)
			}
		}
	}
}
