package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

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
	s.hoverFormat = preferredHoverFormat(params.Capabilities)
	s.inlayHintRefreshSupport, s.codeLensRefreshSupport = refreshSupport(params.Capabilities)
	s.openDevtoolsCommand = initializationClientCommands(params.InitializationOptions).OpenDevtools
	s.settings = mergeSettings(s.settings, params.InitializationOptions)
	s.trusted = initializationWorkspaceTrusted(params.InitializationOptions)
	s.mu.Unlock()

	return jsonrpc.HandlerResult{Result: protocol.InitializeResult{
		Capabilities: protocol.ServerCapabilities{
			TextDocumentSync: protocol.TextDocumentSyncOptions{
				OpenClose: true,
				Change:    protocol.SyncIncremental,
				Save:      protocol.SaveOptions{IncludeText: false},
			},
			HoverProvider:          true,
			DefinitionProvider:     true,
			ReferencesProvider:     true,
			DocumentSymbolProvider: true,
			CodeActionProvider: protocol.CodeActionOptions{
				CodeActionKinds: []protocol.CodeActionKind{protocol.CodeActionQuickFix},
			},
			ExecuteCommandProvider: protocol.ExecuteCommandOptions{
				Commands: []string{runFixCommand},
			},
			WorkspaceSymbolProvider: true,
			InlayHintProvider:       true,
			CodeLensProvider:        protocol.CodeLensOptions{ResolveProvider: false},
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

type clientCommands struct {
	OpenDevtools bool `json:"openDevtools"`
}

func initializationClientCommands(raw json.RawMessage) clientCommands {
	var options struct {
		ClientCommands clientCommands `json:"clientCommands"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &options) != nil {
		return clientCommands{}
	}
	return options.ClientCommands
}

func refreshSupport(capabilities *protocol.ClientCapabilities) (inlayHint, codeLens bool) {
	if capabilities == nil || capabilities.Workspace == nil {
		return false, false
	}
	workspace := capabilities.Workspace
	if workspace.InlayHint != nil {
		inlayHint = workspace.InlayHint.RefreshSupport
	}
	if workspace.CodeLens != nil {
		codeLens = workspace.CodeLens.RefreshSupport
	}
	return inlayHint, codeLens
}

func initializationWorkspaceTrusted(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return true
	}
	var options struct {
		WorkspaceTrust *bool `json:"workspaceTrust"`
	}
	if json.Unmarshal(raw, &options) != nil || options.WorkspaceTrust == nil {
		return true
	}
	return *options.WorkspaceTrust
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
