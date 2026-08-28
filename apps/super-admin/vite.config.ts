import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    proxy: {
      '/admin': {
        target: 'http://127.0.0.1:4000',
      },
    },
  },
});
