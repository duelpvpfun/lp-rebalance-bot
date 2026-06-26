// Stub for rpc-websockets — @solana/web3.js v1 imports it for subscription
// support, but we only use HTTP RPC. Cloudflare workerd can't resolve the
// real package's export conditions, so we replace it with no-ops.
class StubClient {
  constructor() {}
  on() { return this; }
  once() { return this; }
  off() { return this; }
  removeListener() { return this; }
  removeAllListeners() { return this; }
  call() { return Promise.resolve(); }
  notify() { return Promise.resolve(); }
  connect() {}
  close() {}
}

export const Client = StubClient;
export const CommonClient = StubClient;
export const WebSocket = StubClient;
export default { Client: StubClient, CommonClient: StubClient, WebSocket: StubClient };
