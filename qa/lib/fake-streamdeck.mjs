/* A minimal stand-in for the Stream Deck app: enough of RFC 6455 to register a plugin,
   push it events, and read back the commands it sends. Hand-rolled so the test suite
   needs no extra dependency. Text frames only — that is all the SD protocol uses. */
import { createServer } from "http";
import { createHash } from "crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function fakeStreamDeck(port = 28196) {
  const sent = [];                 // everything the plugin sent us
  let sock = null, onMsg = null;

  const encode = (str) => {
    const p = Buffer.from(str, "utf8");
    let head;
    if (p.length < 126) head = Buffer.from([0x81, p.length]);
    else if (p.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(p.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(p.length), 2); }
    return Buffer.concat([head, p]);
  };

  /* The real Stream Deck app listens on 28196. Binding blind means the plugin under test
     quietly connects to the REAL app instead of this stand-in, and the suite then sees no
     traffic at all and blames the plugin — which is exactly what happened once. */
  const srv = createServer();
  srv.on("error", (e) => {
    console.error(`\nFATAL: cannot listen on ${port} (${e.code}).` +
      (e.code === "EADDRINUSE" ? "  Something else owns it — the Stream Deck app uses 28196." : ""));
    process.exit(1);
  });
  srv.listen(port);
  srv.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
      "Connection: Upgrade\r\nSec-WebSocket-Accept: " +
      createHash("sha1").update(key + GUID).digest("base64") + "\r\n\r\n");
    sock = socket;
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const body = buf.subarray(off + maskLen, off + maskLen + len);
        if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
        buf = buf.subarray(off + maskLen + len);
        try { const m = JSON.parse(body.toString("utf8")); sent.push(m); onMsg && onMsg(m); }
        catch (_) { /* control frame */ }
      }
    });
    socket.on("error", () => {});
  });

  return {
    port,
    sent,
    onMessage(fn) { onMsg = fn; },
    to(obj) { sock && sock.write(encode(JSON.stringify(obj))); },
    /* wait for a command matching pred, or time out */
    async wait(pred, ms = 8000) {
      const t0 = Date.now();
      for (;;) {
        const hit = sent.filter(pred);
        if (hit.length) return hit[hit.length - 1];
        if (Date.now() - t0 > ms) return null;
        await new Promise(r => setTimeout(r, 60));
      }
    },
    close() { try { sock && sock.destroy(); } catch (_) {} srv.close(); },
  };
}
