import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import branding from './src/branding/app-branding.json';
import lanAuth from './src/lan-auth/config.json' with { type: 'json' };
import { defineConfig } from 'vite';

function readLanAuthCa(): string | null {
  if (!lanAuth.useBundledCa) return null;
  if (new URL(lanAuth.serverUrl).protocol !== 'https:') {
    throw new Error('LAN login requires an HTTPS serverUrl when useBundledCa is enabled.');
  }

  const caFile = new URL('./gilbert-lan-ca.crt', import.meta.url);
  try {
    const pem = readFileSync(caFile, 'utf8').trim();
    if (
      !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/.test(
        pem
      )
    ) {
      throw new Error('Expected exactly one PEM certificate.');
    }
    const root = new X509Certificate(pem);
    if (!root.ca || !root.checkIssued(root) || !root.verify(root.publicKey)) {
      throw new Error('Expected a self-signed root CA certificate.');
    }
    return root.toString();
  } catch (error) {
    throw new Error('Copy the Caddy public root certificate to ui/desktop/gilbert-lan-ca.crt.', {
      cause: error,
    });
  }
}

// https://vitejs.dev/config
export default defineConfig({
  define: {
    'process.env.GITHUB_OWNER': JSON.stringify(process.env.GITHUB_OWNER || 'aaif-goose'),
    'process.env.GITHUB_REPO': JSON.stringify(process.env.GITHUB_REPO || 'goose'),
    'process.env.GOOSE_BUNDLE_NAME': JSON.stringify(branding.Name),
    'import.meta.env.GILBERT_LAN_CA': JSON.stringify(readLanAuthCa()),
  },
});
