package api

import (
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

// WSClient connects to the devtools WebSocket for live event streaming.
type WSClient struct {
	conn *websocket.Conn
	done chan struct{}
}

// ConnectWS connects to the devtools WebSocket endpoint.
func ConnectWS(baseURL string) (*WSClient, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	u.Scheme = "ws"
	u.Path = "/ws/ui"

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("cannot connect to devtools WebSocket at %s: %w", u.String(), err)
	}

	return &WSClient{conn: conn, done: make(chan struct{})}, nil
}

// ReadMessages reads messages from the WebSocket and sends them to the channel.
// Closes the channel when the connection is closed.
func (ws *WSClient) ReadMessages(ch chan<- json.RawMessage) {
	defer close(ch)
	for {
		_, msg, err := ws.conn.ReadMessage()
		if err != nil {
			return
		}
		ch <- json.RawMessage(msg)
	}
}

// Close closes the WebSocket connection.
func (ws *WSClient) Close() {
	select {
	case <-ws.done:
	default:
		close(ws.done)
	}
	ws.conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	ws.conn.Close()
}
