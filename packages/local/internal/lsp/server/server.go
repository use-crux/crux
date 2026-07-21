// Package server implements the Crux LSP lifecycle and method dispatcher.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"path/filepath"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
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
		options:   options,
		outbound:  make(chan protocol.Notification, 256),
		settings:  defaultSettings(options.Port),
		documents: make(map[protocol.DocumentURI]documentStatus),
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
	case protocol.MethodDidOpen:
		s.didOpen(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidSave:
		s.didSave(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidClose:
		s.didClose(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidChangeConfiguration:
		s.didChangeConfiguration(request.Params)
		return jsonrpc.HandlerResult{}
	case protocol.MethodDidChange,
		protocol.MethodCancelRequest:
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

// WorkspaceFolders returns the initialize-time scope candidates.
func (s *Server) WorkspaceFolders() []protocol.WorkspaceFolder {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]protocol.WorkspaceFolder(nil), s.folders...)
}

func (s *Server) initialize(raw json.RawMessage) jsonrpc.HandlerResult {
	params := protocol.InitializeParams{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
				Code:    protocol.InvalidParamsCode,
				Message: "Invalid initialize params",
			}}
		}
	}

	folders := initializeFolders(params, s.options.Root)
	s.mu.Lock()
	s.folders = folders
	s.clientInfo = params.ClientInfo
	s.settings = mergeSettings(s.settings, params.InitializationOptions)
	s.mu.Unlock()

	return jsonrpc.HandlerResult{Result: protocol.InitializeResult{
		Capabilities: protocol.ServerCapabilities{
			TextDocumentSync: protocol.TextDocumentSyncOptions{
				OpenClose: true,
				Change:    protocol.SyncNone,
				Save:      protocol.SaveOptions{IncludeText: false},
			},
			CodeActionProvider: protocol.CodeActionOptions{
				CodeActionKinds: []protocol.CodeActionKind{protocol.CodeActionQuickFix},
			},
			Workspace: protocol.WorkspaceOptions{
				WorkspaceFolders: protocol.WorkspaceFoldersOptions{
					Supported:           true,
					ChangeNotifications: false,
				},
			},
		},
		ServerInfo: protocol.ServerInfo{Name: "crux-lsp", Version: s.options.Version},
	}}
}

func (s *Server) initializedScopes(ctx context.Context) {
	s.mu.Lock()
	if s.initialized {
		s.mu.Unlock()
		return
	}
	scopeContext, cancel := context.WithCancel(ctx)
	s.initialized = true
	s.scopeCancel = cancel
	folders := append([]protocol.WorkspaceFolder(nil), s.folders...)
	settings := s.settings
	workspace := s.workspace
	if workspace == nil {
		workspace = newWorkspaceRuntime(s)
		s.workspace = workspace
	}
	s.mu.Unlock()

	for _, folder := range folders {
		fmt.Fprintf(s.options.Logs, "crux lsp: detected workspace folder %s\n", folder.URI)
	}
	workspace.Start(scopeContext, folders, settings)
	go func() {
		<-scopeContext.Done()
		workspace.Close()
	}()
	if s.options.OnInitialized != nil {
		s.options.OnInitialized(scopeContext, folders)
	}
}

func methodDirectionMatches(request protocol.Request) bool {
	requestMethod := request.Method == protocol.MethodInitialize ||
		request.Method == protocol.MethodShutdown ||
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

func initializeFolders(params protocol.InitializeParams, fallbackRoot string) []protocol.WorkspaceFolder {
	if len(params.WorkspaceFolders) > 0 {
		return append([]protocol.WorkspaceFolder(nil), params.WorkspaceFolders...)
	}
	if params.RootURI != "" {
		return []protocol.WorkspaceFolder{{URI: params.RootURI, Name: folderName(params.RootURI)}}
	}
	if fallbackRoot == "" {
		return nil
	}
	absolute := fallbackRoot
	if !mapping.IsAbsolutePath(absolute) {
		var err error
		absolute, err = filepath.Abs(fallbackRoot)
		if err != nil {
			absolute = fallbackRoot
		}
	}
	uri := protocol.DocumentURI(mapping.FileURI("", absolute))
	return []protocol.WorkspaceFolder{{
		URI:  uri,
		Name: folderName(uri),
	}}
}

func folderName(uri protocol.DocumentURI) string {
	parsed, err := url.Parse(string(uri))
	if err != nil || parsed.Path == "" {
		return string(uri)
	}
	return filepath.Base(parsed.Path)
}
