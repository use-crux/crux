package bridge

import (
	"encoding/json"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
)

func RegisterRoutes(mux *http.ServeMux, bridge *runtimebridge.Service) {
	mux.HandleFunc("GET /api/runtime/bridge/peers", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, bridge.Peers())
	})
	mux.HandleFunc("POST /api/runtime/bridge/peers", func(w http.ResponseWriter, r *http.Request) {
		var peer runtimebridge.Peer
		if err := json.NewDecoder(r.Body).Decode(&peer); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if peer.Transport == "" {
			peer.Transport = runtimebridge.TransportHTTP
		}
		// HTTP peers are dispatched to by the server, so confine their callback
		// URL to loopback to prevent SSRF.
		if peer.Transport == runtimebridge.TransportHTTP && !runtimebridge.IsLoopbackEndpoint(peer.EndpointURL) {
			http.Error(w, "HTTP runtime peer endpointUrl must be a loopback address", http.StatusBadRequest)
			return
		}
		writeJSON(w, bridge.RegisterPeer(peer, nil))
	})
	mux.HandleFunc("POST /api/runtime/bridge/commands", func(w http.ResponseWriter, r *http.Request) {
		var req runtimebridge.DispatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		resp, err := bridge.Dispatch(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, resp)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
