// Node.js (Render / local host) transport. Vite replaces this module for Cloudflare.
export { io } from 'socket.io-client';
export const persistentActivity = false;
export function pushedFetch(_kind: 'host' | 'spectator') {
  return (url: string, options?: RequestInit) => fetch(url, { ...options, cache: 'no-store' });
}
