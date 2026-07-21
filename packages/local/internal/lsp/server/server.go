// Package server implements the Crux LSP lifecycle and method dispatcher.
package server

import (
	"context"
	"io"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// Options configures one LSP server process.
type Options struct {
	Version string
	Root    string
	Port    int
	Logs    io.Writer
	// Now timestamps save notifications for staleness telemetry.
	Now func() time.Time
	// OnInitialized observes scope startup after the workspace runtime begins.
	OnInitialized func(context.Context, []protocol.WorkspaceFolder)
}

// Server handles the P1 LSP method surface.
type Server struct {
	options Options

	mu          sync.Mutex
	shutdown    bool
	exitCode    int
	folders     []protocol.WorkspaceFolder
	clientInfo  *protocol.ClientInfo
	initialized bool
	scopeCancel context.CancelFunc
	outbound    chan protocol.Notification
	settings    Settings
	hoverFormat protocol.MarkupKind
	workspace   workspaceController
	documents   map[protocol.DocumentURI]documentStatus
}

type documentStatus struct {
	Open    bool
	SavedAt time.Time
}

// New creates an LSP server with no active scopes.
func New(options Options) *Server {
	if options.Logs == nil {
		options.Logs = io.Discard
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	return &Server{
		options:     options,
		outbound:    make(chan protocol.Notification, 256),
		settings:    defaultSettings(options.Port),
		hoverFormat: protocol.MarkupKindPlainText,
		documents:   make(map[protocol.DocumentURI]documentStatus),
	}
}

// Outbound returns asynchronous LSP notifications for the JSON-RPC writer.
func (s *Server) Outbound() <-chan protocol.Notification { return s.outbound }

// Notify queues one server-to-client notification without writing to stdout
// directly. The JSON-RPC transport remains the sole write owner.
func (s *Server) Notify(ctx context.Context, method string, params any) bool {
	select {
	case s.outbound <- protocol.Notification{JSONRPC: protocol.JSONRPCVersion, Method: method, Params: params}:
		return true
	case <-ctx.Done():
		return false
	}
}

// Handle dispatches one decoded JSON-RPC message.
func (s *Server) Handle(ctx context.Context, request protocol.Request) jsonrpc.HandlerResult {
	if request.Method != protocol.MethodInitialize {
		s.traceMethod(ctx, request.Method)
	}
	if !methodDirectionMatches(request) {
		if request.IsNotification() {
			return jsonrpc.HandlerResult{}
		}
		return methodNotFound()
	}
	switch request.Method {
	case protocol.MethodInitialize:
		result := s.initialize(request.Params)
		s.traceMethod(ctx, request.Method)
		return result
	case protocol.MethodInitialized:
		s.initializedScopes(ctx)
		return jsonrpc.HandlerResult{}
	case protocol.MethodShutdown:
		s.mu.Lock()
		s.shutdown = true
		cancel := s.scopeCancel
		s.scopeCancel = nil
		s.mu.Unlock()
		s.closeWorkspace()
		if cancel != nil {
			cancel()
		}
		return jsonrpc.HandlerResult{Result: nil}
	case protocol.MethodExit:
		s.mu.Lock()
		if !s.shutdown {
			s.exitCode = 1
		}
		cancel := s.scopeCancel
		s.scopeCancel = nil
		s.mu.Unlock()
		s.closeWorkspace()
		if cancel != nil {
			cancel()
		}
		return jsonrpc.HandlerResult{Stop: true}
	case protocol.MethodCodeAction:
		return s.codeAction(request.Params)
	case protocol.MethodHover:
		return s.hover(request.Params)
	case protocol.MethodDidOpen:
		s.didOpen(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidSave:
		s.didSave(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidClose:
		s.didClose(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidChange:
		s.didChange(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidChangeConfiguration:
		s.didChangeConfiguration(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodCancelRequest:
		return jsonrpc.HandlerResult{}
	default:
		if request.IsNotification() {
			return jsonrpc.HandlerResult{}
		}
		return methodNotFound()
	}
}

// ExitCode reports the process status requested by the LSP lifecycle.
func (s *Server) ExitCode() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode
}

func methodDirectionMatches(request protocol.Request) bool {
	requestMethod := request.Method == protocol.MethodInitialize ||
		request.Method == protocol.MethodShutdown ||
		request.Method == protocol.MethodHover ||
		request.Method == protocol.MethodCodeAction
	if requestMethod {
		return !request.IsNotification()
	}
	notificationMethod := request.Method == protocol.MethodInitialized ||
		request.Method == protocol.MethodExit ||
		request.Method == protocol.MethodDidOpen ||
		request.Method == protocol.MethodDidClose ||
		request.Method == protocol.MethodDidSave ||
		request.Method == protocol.MethodDidChange ||
		request.Method == protocol.MethodDidChangeConfiguration ||
		request.Method == protocol.MethodCancelRequest
	if notificationMethod {
		return request.IsNotification()
	}
	return true
}

func methodNotFound() jsonrpc.HandlerResult {
	return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
		Code:    protocol.MethodNotFoundCode,
		Message: "Method not found",
	}}
}
