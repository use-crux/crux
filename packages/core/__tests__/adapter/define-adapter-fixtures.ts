export interface MockClient {
  apiKey: string;
}

export interface MockResponse {
  id: string;
  content: string;
}

export interface MockStream {
  [Symbol.asyncIterator]: () => AsyncIterator<{ text: string }>;
}
