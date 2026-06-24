package semantic

import "github.com/use-crux/crux/packages/local/internal/nodeworker"

func findNodePath() (string, error) {
	return nodeworker.FindNodePath()
}
