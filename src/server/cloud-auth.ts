import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export class CloudAuth {
  private salt = randomBytes(16);
  private digest: Buffer;
  private sessions = new Map<string, number>();
  private attempts: number[] = [];
  constructor(password: string, private now = Date.now) {
    if (password.length < 16 || password.length > 256) throw new Error('HOST_PASSWORD 必須為 16～256 個字元。');
    this.digest = scryptSync(password, this.salt, 32);
  }
  private token(req: IncomingMessage) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('__Host-hospital='))?.slice('__Host-hospital='.length) || ''; }
  authorized(req: IncomingMessage) {
    for (const [token, expiry] of this.sessions) if (expiry <= this.now()) this.sessions.delete(token);
    return this.sessions.has(this.token(req));
  }
  logout(req: IncomingMessage, res: ServerResponse) {
    this.sessions.delete(this.token(req));
    res.setHeader('Set-Cookie', '__Host-hospital=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  }
  async login(password: string, res: ServerResponse) {
    this.attempts = this.attempts.filter(t => t > this.now() - 60_000);
    if (this.attempts.length >= 20) return 429;
    this.attempts.push(this.now());
    if (password.length < 16 || password.length > 256) return 401;
    const digest = await new Promise<Buffer>((ok, fail) => scrypt(password, this.salt, 32, (e, result) => e ? fail(e) : ok(result)));
    if (!timingSafeEqual(digest, this.digest)) return 401;
    const token = randomBytes(32).toString('base64url');
    for (const [id, expiry] of this.sessions) if (expiry <= this.now()) this.sessions.delete(id);
    if (this.sessions.size >= 32) this.sessions.delete(this.sessions.keys().next().value!);
    this.sessions.set(token, this.now() + 8 * 60 * 60_000);
    res.setHeader('Set-Cookie', `__Host-hospital=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
    return 200;
  }
}
export function loginPage(error = false) {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>醫院資安攻防戰 · 指揮中心登入</title><style>body{margin:0;background:#0c142b;color:#ecf2ff;font:18px system-ui;min-height:100dvh;display:grid;place-items:center}main{box-sizing:border-box;width:min(440px,92vw);padding:32px;background:#1c2b48;border:2px solid #64799c;border-radius:22px;box-shadow:0 8px #050c1c}h1{color:#ffe087}label{display:block;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;border-radius:12px}input{background:#0c142b;color:white;border:2px solid #64799c}button{margin-top:24px;border:0;background:#ffd473;color:#172038;font-weight:bold;cursor:pointer}p{line-height:1.6;font-size:15px}a{color:#8ee8d7}.error{color:#ffb6a7}</style><main><p>CYBER CARE · MISSION CONTROL</p><h1>指揮中心登入</h1>${error ? '<p class="error" role="alert">密碼不正確或嘗試過於頻繁，請稍後重試。</p>' : ''}<form method="post" action="/host/login"><label for="password">主持密碼</label><input id="password" name="password" type="password" minlength="16" maxlength="256" autocomplete="current-password" required><button type="submit">進入指揮中心</button></form><p>僅供主持人使用。<a href="/">回到玩家入口</a></p></main></html>`;
}
