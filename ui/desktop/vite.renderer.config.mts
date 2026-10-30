import { APP_NAME } from './src/branding';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  define: {
    'process.env.GOOSE_TUNNEL': JSON.stringify(
      process.env.GOOSE_TUNNEL !== 'no' && process.env.GOOSE_TUNNEL !== 'none'
    ),
  },

  plugins: [
    tailwindcss(),
    {
      name: 'desktop-branding-title',
      transformIndexHtml(html) {
        const title = APP_NAME.replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;');
        return html.replace('<title>__APP_NAME__</title>', `<title>${title}</title>`);
      },
    },
  ],

  // Vite caches a copy of @aaif/goose-acp-client and doesn't notice when we rebuild it
  // locally, so it serves stale code until you clear node_modules/.vite by hand.
  // Excluding it makes Vite always read the latest ui/goose-acp-client/dist build.
  // Dev-server only — release builds ignore optimizeDeps.
  optimizeDeps: {
    exclude: ['@aaif/goose-acp-client'],
  },

  build: {
    target: 'esnext',
  },
});
