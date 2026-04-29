// SLAIF WebSocket relay adapter.
// This is the boundary between upstream wassh/nassh runtime and the SLAIF relay.

export class SlaifRelayStream {
  constructor({relayUrl, relayToken}) {
    this.relayUrl = relayUrl;
    this.relayToken = relayToken;
    this.ws = null;
    this.onDataAvailable = null;
    this.onClose = null;
  }

  async open() {
    this.ws = new WebSocket(this.relayUrl, ['slaif-ssh-relay-v1']);
    this.ws.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('relay websocket open timeout')), 10000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, {once: true});
      this.ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('relay websocket open failed'));
      }, {once: true});
    });

    const authResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('relay auth timeout')), 10000);
      const onMessage = (event) => {
        clearTimeout(timeout);
        this.ws.removeEventListener('message', onMessage);
        if (typeof event.data !== 'string') {
          reject(new Error('expected relay auth response text frame'));
          return;
        }
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== 'ok') {
            reject(new Error(`relay auth failed: ${event.data}`));
            return;
          }
          resolve(msg);
        } catch (e) {
          reject(e);
        }
      };
      this.ws.addEventListener('message', onMessage);
      this.ws.send(JSON.stringify({
        type: 'auth',
        relayToken: this.relayToken,
      }));
    });

    this.ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        console.warn('unexpected relay text frame after auth', event.data);
        return;
      }
      this.onDataAvailable?.(event.data);
    };

    this.ws.onclose = () => {
      this.onClose?.();
    };

    return authResult;
  }

  async write(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('relay websocket is not open');
    }

    // `data` may be ArrayBuffer, Uint8Array, or another ArrayBufferView.
    if (data instanceof ArrayBuffer) {
      this.ws.send(data);
    } else if (ArrayBuffer.isView(data)) {
      this.ws.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } else {
      throw new TypeError('relay write expects ArrayBuffer or typed array');
    }
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'client_close');
    }
  }
}

export class SlaifRelay {
  constructor({policyHost, relayUrl, relayToken}) {
    this.policyHost = policyHost;
    this.relayUrl = relayUrl;
    this.relayToken = relayToken;
  }

  async init() {
    return true;
  }

  async openSocket(host, port) {
    // WASSH/OpenSSH asks for a socket to the SSH target. We only allow the
    // exact host/port from extension policy. The relay token independently maps
    // to the same destination on the server side.
    if (host !== this.policyHost.sshHost || Number(port) !== Number(this.policyHost.sshPort)) {
      console.error('Blocked unexpected relay target', {host, port});
      return null;
    }

    const stream = new SlaifRelayStream({
      relayUrl: this.relayUrl,
      relayToken: this.relayToken,
    });

    await stream.open();
    return stream;
  }

  saveState() {
    return {};
  }

  loadState(_state) {
    // No reconnect state yet.
  }
}
