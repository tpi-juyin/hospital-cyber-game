import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => ({
  resolve: { alias: mode === 'cloudflare' ? [{ find: /^\.\/transport$/, replacement: resolve('src/client/transport-cloudflare.ts') }] : [] },
  publicDir: mode === 'cloudflare' ? 'public-cloudflare' : false,
  build: { outDir: mode === 'cloudflare' ? 'dist-cloudflare' : 'dist', rollupOptions: { input: { player: resolve('index.html'), host: resolve('host.html'), watch: resolve('watch.html') } } },
}));
