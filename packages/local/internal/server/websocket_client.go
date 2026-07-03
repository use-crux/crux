package server

import (
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	websocketClientSendBuffer = 256
	websocketWriteDeadline    = 5 * time.Second
)

type wsClient struct {
	hub       *WSHub
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
}

func newWSClient(hub *WSHub, conn *websocket.Conn) *wsClient {
	return &wsClient{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, websocketClientSendBuffer),
		done: make(chan struct{}),
	}
}

func (c *wsClient) enqueue(data []byte) bool {
	select {
	case <-c.done:
		return false
	case c.send <- data:
		return true
	default:
		c.close()
		return false
	}
}

func (c *wsClient) writePump() {
	defer c.close()
	for {
		select {
		case <-c.done:
			return
		case data := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(websocketWriteDeadline)); err != nil {
				slog.Debug("websocket write deadline failed, removing client", "error", err)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				slog.Debug("websocket write failed, removing client", "error", err)
				return
			}
		}
	}
}

func (c *wsClient) close() int {
	remaining := -1
	c.closeOnce.Do(func() {
		remaining = c.hub.removeClient(c)
		close(c.done)
		if c.conn != nil {
			_ = c.conn.Close()
		}
	})
	if remaining >= 0 {
		return remaining
	}
	return c.hub.ClientCount()
}
