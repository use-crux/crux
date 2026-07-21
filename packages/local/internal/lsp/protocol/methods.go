package protocol

const (
	MethodInitialize             = "initialize"
	MethodInitialized            = "initialized"
	MethodShutdown               = "shutdown"
	MethodExit                   = "exit"
	MethodDidOpen                = "textDocument/didOpen"
	MethodDidClose               = "textDocument/didClose"
	MethodDidSave                = "textDocument/didSave"
	MethodDidChange              = "textDocument/didChange"
	MethodHover                  = "textDocument/hover"
	MethodCodeAction             = "textDocument/codeAction"
	MethodDidChangeConfiguration = "workspace/didChangeConfiguration"
	MethodPublishDiagnostics     = "textDocument/publishDiagnostics"
	MethodLogMessage             = "window/logMessage"
	MethodShowMessage            = "window/showMessage"
	MethodCancelRequest          = "$/cancelRequest"
)
