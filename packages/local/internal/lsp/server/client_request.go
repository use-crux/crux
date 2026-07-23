package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const defaultClientRequestTimeout = 5 * time.Second
const maxPendingClientRequests = 256

type pendingClientRequest struct {
	method string
	timer  *time.Timer
}

// RequestClient queues a best-effort server-to-client request. It never waits
// for outbound capacity or for the client's response.
func (s *Server) RequestClient(method string, params any) bool {
	s.clientRequestMu.Lock()
	if len(s.pendingClientRequests) >= maxPendingClientRequests {
		s.clientRequestMu.Unlock()
		return false
	}
	s.nextClientRequestID++
	id := strconv.FormatUint(s.nextClientRequestID, 10)
	pending := &pendingClientRequest{method: method}
	s.pendingClientRequests[id] = pending
	timeout := s.options.ClientRequestTimeout
	if timeout <= 0 {
		timeout = defaultClientRequestTimeout
	}
	pending.timer = time.AfterFunc(timeout, func() {
		s.expireClientRequest(id, method)
	})
	s.clientRequestMu.Unlock()

	message := protocol.OutboundMessage{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage(id),
		Method:  method,
		Params:  params,
	}
	select {
	case s.outbound <- message:
		return true
	default:
		s.dropClientRequest(id)
		return false
	}
}

// HandleClientResponse resolves a pending server-to-client request. Unknown
// or malformed IDs are intentionally ignored.
func (s *Server) HandleClientResponse(response protocol.Response) {
	id, ok := normalizedClientRequestID(response.ID)
	if !ok {
		return
	}
	s.dropClientRequest(id)
}

// CloseClientRequests releases timers when the JSON-RPC session ends.
func (s *Server) CloseClientRequests() {
	s.closeClientRequests()
}

func (s *Server) expireClientRequest(id, method string) {
	s.clientRequestMu.Lock()
	if _, ok := s.pendingClientRequests[id]; !ok {
		s.clientRequestMu.Unlock()
		return
	}
	delete(s.pendingClientRequests, id)
	s.clientRequestMu.Unlock()
	fmt.Fprintf(s.options.Logs, "crux lsp: %s request %s timed out\n", method, id)
}

func (s *Server) dropClientRequest(id string) {
	s.clientRequestMu.Lock()
	pending, ok := s.pendingClientRequests[id]
	if ok {
		delete(s.pendingClientRequests, id)
	}
	s.clientRequestMu.Unlock()
	if ok && pending.timer != nil {
		pending.timer.Stop()
	}
}

func (s *Server) closeClientRequests() {
	s.clientRequestMu.Lock()
	pending := s.pendingClientRequests
	s.pendingClientRequests = make(map[string]*pendingClientRequest)
	s.clientRequestMu.Unlock()
	for _, request := range pending {
		if request.timer != nil {
			request.timer.Stop()
		}
	}
}

func normalizedClientRequestID(raw json.RawMessage) (string, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if len(raw) == 0 || decoder.Decode(&value) != nil {
		return "", false
	}
	switch value := value.(type) {
	case json.Number:
		parsed, err := strconv.ParseUint(string(value), 10, 64)
		return strconv.FormatUint(parsed, 10), err == nil
	default:
		return "", false
	}
}
