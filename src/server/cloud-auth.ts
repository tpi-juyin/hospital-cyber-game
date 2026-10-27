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
export { loginPage } from './login-page';
