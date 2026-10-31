# White-label Desktop configuration

The complete patch combines the LAN login integration, pre-login theme support,
centralized application strings, and centralized Gilbert artwork. It targets
the ericrasmussen1024/goose fork at
`775b3958c394ae2747cfb01791d3a45ac579139a` (Desktop 1.57.0).

## Configuration

| Change                                                   | Location                                           |
| -------------------------------------------------------- | -------------------------------------------------- |
| Product name                                             | `src/branding/app-branding.json`, top-level `Name` |
| Branded text, descriptions, page inventory, translations | `src/branding/app-branding.json`, `strings`        |
| Logos, native icons, animation frames, installer artwork | `src/branding/assets/`                             |
| Animation filenames, frame order, timing, rendering mode | `src/branding/assets/manifest.json`                |
| LAN authentication URL                                   | `src/lan-auth/config.json`, `serverUrl`            |

`Name` is authoritative for the login screen and native application.
After changing `Name`, run `pnpm branding:sync`, then rebuild. The updater's
release asset names also follow the configured product name. Keep your release
publishing configuration consistent with the artifacts you build.

The source strings include descriptions and UI surfaces. Technical compatibility
identifiers, protocol names, profile directories, configuration keys, and real
upstream documentation URLs retain their original values. Third-party logos and
upstream attribution retain their own identities.

## Build and check

Use the fork's existing development prerequisites and platform binary preparation.
The patch adds no JavaScript dependency. From `ui` run `pnpm install`, then from
`ui/desktop`:

```bash
pnpm branding:sync
pnpm branding:check
pnpm run typecheck
pnpm run test:run
pnpm run start-gui
```

Use `pnpm run make` for the existing platform-specific packaging workflow. On
Windows the existing `make:win32-installer <packaged-directory>` step wraps the
packaged application in the NSIS installer. The native icon exports are already
included. See [the artwork guide](src/branding/assets/README.md) for replacement
and regeneration instructions.

## LAN login

Set `serverUrl` to the server reachable from user workstations, such as
`https://ai-server.lan:8443`. Workstations must trust its HTTPS certificate. The
login adapter expects the attached Phase 1 server's `/auth/login`, `/auth/me`,
and `/auth/logout` endpoints and its opaque bearer tokens.

The main process keeps the token in memory and exposes only public account
state to the renderer. Expiry, revocation, logout, and periodic account checks
close the UI gate and reload regular app windows. The login shares the app's
saved Light/Dark/Aura/System theme provider from initial render.

Created Apps share this main-process account instead of asking for a separate
login. Their registered desktop shells can read public account state and their
bound local ACP connection while signed in. Login/logout and local file access
remain limited to regular desktop windows; generated app iframes cannot call the
shared-session IPC handlers. All created App windows are destroyed when the
session ends, and new app launches require a signed-in desktop window.

This is the desktop integration for that server. The Phase 1 backend remains
a separate deployment. It does not yet proxy model inference or enforce grants
on inference requests, and this patch does not add remote MCP authentication.
Desktop login does not isolate local data or tools from other users of the same
OS profile. Use separate OS accounts when that isolation is required.

## Artwork coverage

The centralized artwork replaces the sidebar header, app watermark, onboarding icons, recipe
illustration, login mark, version icon, suspense logo, active chat animation, and MCP app
loading animation. Active chat states rotate through the six approved Gilbert
frames every 155 ms; idle and waiting states use the static icon. Reduced-motion
mode uses the static icon without a timer.

Electron Forge, Windows NSIS, Linux desktop entries, window icons, taskbar/Dock
icons, normal tray icons, and update tray icons use the same asset folder.
The old embedded Goose/Bird SVG components, src/images exports, and old installer
bitmaps are removed. A native resource check runs before packaging to detect
missing or stale exports.

Native executable/shortcut icons require rebuilding and reinstalling. The
automated suite and production bundle checks do not replace testing signed
installers on each supported operating system.
