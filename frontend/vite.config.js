import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';

  return {
    envDir: '..',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
    },
    plugins: [react()],
    build: {
      // Aucun source map n'est publie. Oxc minifie le bundle Vite 8.
      sourcemap: false,
      minify: 'oxc',
      reportCompressedSize: false,
    },
    server: {
       port: 5900, // ou 6000, 8790, 6531, etc,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://127.0.0.1:3001',
          ws: true,
        },
      },
    },
  };
})
