// Package server implements the Crux LSP lifecycle and method dispatcher.
package server

import (
	"context"
	"io"
	"os"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
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
	// FixExecutable resolves the binary spawned for an allowlisted fix. It
	// defaults to os.Executable; tests may substitute a controlled executable.
	FixExecutable func() (string, error)
	// ClientRequestTimeout bounds best-effort server-to-client requests. Zero
	// uses the default timeout.
	ClientRequestTimeout time.Duration
}

// Server handles the Crux LSP method surface.
type Server struct {
	options Options

	mu                        sync.Mutex
	shutdown                  bool
	exitCode                  int
	folders                   []protocol.WorkspaceFolder
	clientInfo                *protocol.ClientInfo
	initialized               bool
	scopeCancel               context.CancelFunc
	outbound                  chan protocol.OutboundMessage
	settings                  Settings
	hoverFormat               protocol.MarkupKind
	inlayHintRefreshSupport   bool
	codeLensRefreshSupport    bool
	promptTextRefreshSupport  bool
	diagnosticVersionSupport  bool
	diagnosticDataSupport     bool
	codeActionLiteralSupport  bool
	codeActionRefactorSupport bool
	openDevtoolsCommand       bool
	trusted                   bool
	workspace                 workspaceController
	documents                 map[protocol.DocumentURI]documentStatus
	buffers                   *documentBuffers
	promptText                *lsprompttext.Controller
	diagnostics               *diagnosticComposer

	fixMu      sync.Mutex
	fixRunning map[string]struct{}

	clientRequestMu       sync.Mutex
	nextClientRequestID   uint64
	pendingClientRequests map[string]*pendingClientRequest

	completionMu          sync.Mutex
	pendingCompletions    map[string]*pendingCompletion
	completionByURI       map[protocol.DocumentURI]*pendingCompletion
	lastCompletionWarning time.Time

	promptTextMu       sync.Mutex
	pendingPromptTexts map[string]*pendingPromptText
	promptTextByURI    map[protocol.DocumentURI]map[*pendingPromptText]struct{}
}

type documentStatus struct {
	Open    bool
	Version int
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
	if options.FixExecutable == nil {
		options.FixExecutable = os.Executable
	}
	server := &Server{
		options:     options,
		outbound:    make(chan protocol.OutboundMessage, 256),
		settings:    defaultSettings(options.Port),
		hoverFormat: protocol.MarkupKindPlainText,
		documents:   make(map[protocol.DocumentURI]documentStatus),
		buffers: newDocumentBuffers(documentBufferLimits{
			DocumentBytes: defaultDocumentBufferBytes,
			ProcessBytes:  defaultProcessBufferBytes,
		}),
		fixRunning:            make(map[string]struct{}),
		pendingClientRequests: make(map[string]*pendingClientRequest),
		pendingCompletions:    make(map[string]*pendingCompletion),
		completionByURI:       make(map[protocol.DocumentURI]*pendingCompletion),
		pendingPromptTexts:    make(map[string]*pendingPromptText),
		promptTextByURI: make(
			map[protocol.DocumentURI]map[*pendingPromptText]struct{},
		),
	}
	server.promptText = lsprompttext.NewController(server.buffers)
	server.diagnostics = newServerDiagnosticComposer(server)
	return server
}

// Outbound returns asynchronous LSP requests and notifications for the
// JSON-RPC writer.
func (s *Server) Outbound() <-chan protocol.OutboundMessage { return s.outbound }

// Notify queues one server-to-client notification without writing to stdout
// directly. The JSON-RPC transport remains the sole write owner.
func (s *Server) Notify(ctx context.Context, method string, params any) bool {
	select {
	case s.outbound <- protocol.OutboundMessage{JSONRPC: protocol.JSONRPCVersion, Method: method, Params: params}:
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
		s.buffers.Clear()
		s.closeClientRequests()
		s.closeCompletionRequests()
		s.closePromptTextRequests()
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
		s.buffers.Clear()
		s.closeClientRequests()
		s.closeCompletionRequests()
		s.closePromptTextRequests()
		if cancel != nil {
			cancel()
		}
		return jsonrpc.HandlerResult{Stop: true}
	case protocol.MethodCodeAction:
		return s.codeActionRequest(ctx, request.ID, request.Params)
	case protocol.MethodExecuteCommand:
		return s.executeCommand(ctx, request.Params)
	case protocol.MethodHover:
		return s.hover(ctx, request.ID, request.Params)
	case protocol.MethodDefinition:
		return s.definition(ctx, request.ID, request.Params)
	case protocol.MethodReferences:
		return s.references(ctx, request.ID, request.Params)
	case protocol.MethodDocumentSymbol:
		return s.documentSymbol(ctx, request.ID, request.Params)
	case protocol.MethodFoldingRange:
		return s.promptTextFolding(ctx, request.ID, request.Params)
	case protocol.MethodDocumentLink:
		return s.promptTextLinks(ctx, request.ID, request.Params)
	case protocol.MethodInlayHint:
		return s.inlayHint(request.Params)
	case protocol.MethodCodeLens:
		return s.codeLens(request.Params)
	case protocol.MethodCompletion:
		return s.completion(ctx, request.ID, request.Params)
	case protocol.MethodPromptTextDecorations:
		return s.promptTextDecorations(ctx, request.ID, request.Params)
	case protocol.MethodPromptTextPreviewStatic:
		return s.promptTextPreviewStatic(ctx, request.ID, request.Params)
	case protocol.MethodPromptTextPreviewExactLink:
		return s.promptTextPreviewExactLink(ctx, request.ID, request.Params)
	case protocol.MethodPromptTextOpenLatestRunLink:
		return s.promptTextOpenLatestRunLink(ctx, request.ID, request.Params)
	case protocol.MethodWorkspaceSymbol:
		return s.workspaceSymbol(ctx, request.Params)
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
		s.cancelRequest(request.Params)
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
		request.Method == protocol.MethodDefinition ||
		request.Method == protocol.MethodReferences ||
		request.Method == protocol.MethodDocumentSymbol ||
		request.Method == protocol.MethodFoldingRange ||
		request.Method == protocol.MethodDocumentLink ||
		request.Method == protocol.MethodInlayHint ||
		request.Method == protocol.MethodCodeLens ||
		request.Method == protocol.MethodCompletion ||
		request.Method == protocol.MethodPromptTextDecorations ||
		request.Method == protocol.MethodPromptTextPreviewStatic ||
		request.Method == protocol.MethodPromptTextPreviewExactLink ||
		request.Method == protocol.MethodPromptTextOpenLatestRunLink ||
		request.Method == protocol.MethodCodeAction ||
		request.Method == protocol.MethodWorkspaceSymbol ||
		request.Method == protocol.MethodExecuteCommand
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
