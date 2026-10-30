import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { APP_NAME } from './index';

// Keep the existing OS profile when the visible product name changes.
const profile = path.join(app.getPath('appData'), 'Goose');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setName(APP_NAME);
if (process.platform === 'linux')
  app.setDesktopName(`${APP_NAME.toLowerCase().replace(/[^a-z0-9+.-]+/g, '-')}.desktop`);
