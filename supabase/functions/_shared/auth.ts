// ============================================================
// Shared panel auth (M7).
//
// The control panel is a static page on GitHub Pages, so it can never hold a
// secret: anything shipped in the HTML/JS is world-readable at the Pages URL.
// Instead the panel logs in with a password, and this module hands back a
// short-lived HMAC-signed session token. Only the token lives on the device;
// PANEL_KEY never leaves the server.
//
// Tokens are signed with PANEL_KEY + PANEL_PASSWORD, so rotating either secret
// immediately invalidates every session that is already out there.
//
// Secrets: supabase secrets set PANEL_KEY=<random32> PANEL_PASSWORD=<password>
// ============================================================

const enc = new TextEncoder();
const TTL_MS = 30 * 24 * 60 * 60 * 1000;          // 30 days per sign-in

const PANEL_KEY = Deno.env.get("PANEL_KEY") ?? "";
const PANEL_PASSWORD = Deno.env.get("PANEL_PASSWORD") ?? "";

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) =>
  atob(s.replace(/-/g, "+").replace(/_/g, "/"));

/* Comparison that does not leak how much of the value matched. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

let signKey: CryptoKey | null = null;
async function hmac(payload: string): Promise<string> {
  signKey ??= await crypto.subtle.importKey(
    "raw", enc.encode(`${PANEL_KEY}:${PANEL_PASSWORD}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", signKey, enc.encode(payload))));
}

export const configured = () => Boolean(PANEL_KEY && PANEL_PASSWORD);

export async function issueToken(): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + TTL_MS })));
  return `${payload}.${await hmac(payload)}`;
}

export function passwordOk(pw: unknown): boolean {
  return Boolean(PANEL_PASSWORD) && safeEqual(String(pw ?? ""), PANEL_PASSWORD);
}

async function tokenOk(token: unknown): Promise<boolean> {
  if (typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!safeEqual(sig, await hmac(payload))) return false;
  try {
    const { exp } = JSON.parse(unb64url(payload));
    return typeof exp === "number" && Date.now() < exp;
  } catch { return false; }
}

/* Who is guessing, for the V19 login lockout (supabase/migrate-v19-login-lockout.sql).
   cf-connecting-ip is set by Cloudflare in front of the edge runtime and measured UNFORGEABLE: a
   request carrying its own is refused (1000/403), and client-sent X-Forwarded-For values are
   discarded. True-Client-IP, by contrast, passes straight through from the client — never use it.
   IPv6 is keyed by /56, the prefix a household is typically delegated (a /64 key let anyone with a
   delegated prefix cycle /64s to dodge the per-client limit — found in review); an IPv4-mapped
   address keys as the IPv4 it carries. This only slows a single-prefix guesser: the GLOBAL
   counter is the real cap against anyone holding several addresses. */
export function clientKey(req: Request): string {
  const raw = (req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  const v4 = raw.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  if (!raw.includes(":")) return raw;
  const [head, tail] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = raw.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  const norm = (x: string) => (x || "0").replace(/^0+(?=.)/, "");
  const g4 = ((parseInt(full[3] ?? "0", 16) || 0) & 0xff00).toString(16);
  return [...full.slice(0, 3).map(norm), g4].join(":") + "::/56";
}

/* A caller is authorized by a valid session token (browsers) or by PANEL_KEY
   itself (server-side scripts and the QA harness, which read it from .env). */
export async function authorized(body: { token?: unknown; key?: unknown }): Promise<boolean> {
  if (!PANEL_KEY) return false;
  if (typeof body.key === "string" && body.key && safeEqual(body.key, PANEL_KEY)) return true;
  return await tokenOk(body.token);
}
