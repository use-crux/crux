package server

func newTrustedCompletionServer(options Options) *Server {
	server := New(options)
	server.trusted = true
	return server
}
