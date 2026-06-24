package semantic

import "github.com/use-crux/crux/packages/local/internal/nodeworker"

func newNodeStreamWorker(name string, content []byte, scriptPath string) *nodeworker.Worker {
	options := []nodeworker.Option{nodeworker.WithMaxResponseBytes(maxResponseBytes)}
	if scriptPath != "" {
		options = append(options, nodeworker.WithScriptPath(scriptPath))
	}
	return nodeworker.New(nodeworker.Script{Name: name, Content: content}, options...)
}
