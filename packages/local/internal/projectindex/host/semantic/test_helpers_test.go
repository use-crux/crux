package semantic

import "github.com/use-crux/crux/packages/local/internal/process/workerproc"

func findNodePath() (string, error) {
	return workerproc.FindNodePath()
}
