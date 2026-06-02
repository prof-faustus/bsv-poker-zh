import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite/esbuild 编译工作区的 TS 源码（各 package 直接导出 ./src/*.ts）。
// 应用只导入浏览器安全的 package（见 App.tsx）—— 使用 node:crypto 的
// package（crypto-mentalpoker、tx-builder、wallet-custody、script-templates-ts）在本
// bundle 中任何位置都不会被引用。
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
