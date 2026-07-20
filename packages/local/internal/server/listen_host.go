package server

import (
	"net"
	"os"
	"strings"
)

// listenHost resolves the interface the local server binds to. It defaults to
// loopback; CRUX_HOST explicitly opts into another interface.
func listenHost() string {
	host := strings.TrimSpace(os.Getenv("CRUX_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	return host
}

func hostIsLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}
