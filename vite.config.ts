import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，保证部署在 GitHub Pages 子路径下资源可用
  base: './',
  server: {
    port: 5173,
    open: false
  },
  build: {
    chunkSizeWarningLimit: 2000
  }
});
