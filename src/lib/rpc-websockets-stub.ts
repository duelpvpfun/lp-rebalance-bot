// rpc-websockets stub: @solana/web3.js v1 imports this for subscription support,
// but we only use HTTP RPC. Cloudflare Workers can't resolve the package's
// workerd export condition, so we stub it out.
export class Client {
  constructor() {}
  on() {}
  call() { return Promise.resolve(); }
  notify() { return Promise.resolve(); }
  close() {}
}
export default { Client };
