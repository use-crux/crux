/** Minimal controllable WebSocket used by exact-preview transport tests. */
export class TestWebSocket {
  static instance: TestWebSocket | undefined;
  static readonly instances: TestWebSocket[] = [];
  readonly sent: string[] = [];
  readonly url: string;
  readyState = 1;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    TestWebSocket.instance = this;
    TestWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.onopen?.({});
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  rawMessage(value: string): void {
    this.onmessage?.({ data: value });
  }

  serverClose(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  static reset(): void {
    TestWebSocket.instance = undefined;
    TestWebSocket.instances.splice(0);
  }
}
