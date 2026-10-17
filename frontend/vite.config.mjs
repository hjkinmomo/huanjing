import {defineConfig} from 'vite';

export default defineConfig({
  define: {'process.env.NODE_ENV':JSON.stringify('production')},
  build: {
    // A dedicated artifact directory; never empty the product's assets directory.
    outDir: '../web/assets/experience/react',
    emptyOutDir: false,
    lib: {entry:'src/chat-entry.tsx',formats:['es'],fileName:()=> 'chat.js'},
    sourcemap: false,
    minify: true,
  },
});
