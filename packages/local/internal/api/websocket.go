package api

import (
	"context"
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
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return ConnectWSContext(ctx, baseURL)
}

// ConnectWebSocket connects the client to live events and preserves the same
// command-aware connection remediation as HTTP requests.
func (c *Client) ConnectWebSocket(ctx context.Context) (*WSClient, error) {
	ws, err := ConnectWSContext(ctx, c.BaseURL)
	if err != nil {
		return nil, c.connectError()
	}
	return ws, nil
}

// ConnectWSContext connects to the devtools WebSocket within the caller's
// lifecycle and deadline budget.
func ConnectWSContext(ctx context.Context, baseURL string) (*WSClient, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	u.Scheme = "ws"
	u.Path = "/ws/ui"

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, u.String(), nil)
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
