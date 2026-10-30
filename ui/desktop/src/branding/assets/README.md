# Application artwork

This is the only source folder for application branding artwork. The supplied
artwork is the previously approved Gilbert pixel robot and six rotation frames.
All filenames are independent of the product name.

| File                                                                                               | Used by                                                                                                          |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `app.svg`                                                                                          | Login mark, watermark, onboarding, recipe illustrations, suspense loader, favicon, and source for native exports |
| `activity-01.svg` through `activity-06.svg`                                                        | Active chat states and MCP app loading; one rotation every 930 ms                                                |
| `manifest.json`                                                                                    | SVG filenames, frame order, 155 ms frame duration, image rendering mode, native filenames                        |
| `app.png`, `app@2x.png`, `app-512.png`                                                             | Native windows, development Dock icon, Linux packages, and Flatpak                                               |
| `app.ico`                                                                                          | Windows executable, taskbar, shortcuts, installer, and uninstaller                                               |
| `app.icns`                                                                                         | macOS application bundle, Finder, and Dock                                                                       |
| `tray.ico`, `tray-update.ico`                                                                      | Windows notification area, normal and update states                                                              |
| `tray.png`, `tray@2x.png`, `tray-update.png`, `tray-update@2x.png`                                 | Linux tray, normal and update states                                                                             |
| `trayTemplate.png`, `trayTemplate@2x.png`, `tray-updateTemplate.png`, `tray-updateTemplate@2x.png` | macOS monochrome menu-bar templates, normal and update states                                                    |
| `installer-sidebar.bmp`, `installer-header.bmp`                                                    | Windows installer and uninstaller artwork                                                                        |
| `generated.json`                                                                                   | SHA-256 record tying the native exports to `app.svg`                                                             |

To replace the brand, replace `app.svg` and the activity SVGs here. Keep the
filenames, or edit `manifest.json` here to choose different activity filenames,
frame order, count, and timing. Set `imageRendering` to `auto` for smooth artwork
instead of pixel art. Use a square SVG canvas with a transparent background.

Regenerate native exports after changing `app.svg` or the rendering mode, then
rebuild/reinstall the desktop application. From `ui/desktop`:

```bash
python3 -m pip install Pillow CairoSVG
python3 scripts/prepare-branding-assets.py
pnpm branding:assets:check
```

On Windows use `py -m pip install Pillow CairoSVG` and
`py scripts/prepare-branding-assets.py` if Python is installed as `py`.
CairoSVG requires the platform Cairo library; install it according to the
[CairoSVG installation guide](https://cairosvg.org/documentation/) if it is absent.
The included native exports are ready to build; Python/CairoSVG are needed only
when regenerating artwork, not for ordinary desktop builds.

The generator renders only the local `app.svg`, builds the ICO/ICNS containers,
creates black alpha templates for macOS, adds the tray update dot, and exports
24-bit installer BMPs. Installer images contain no rasterized product name.
Future brands can supply custom native designs in this folder, but should adapt
the generator and regenerate the integrity record rather than bypass the check.

Packaged native resources are copied by Electron Forge to `resources/assets`.
Development uses the same folder through `app.getAppPath()`, so choosing a
different working directory does not change icon resolution. Renderer assets
are bundled by Vite from this folder. Replacing a file in an installed app is
not sufficient to change an executable or installer icon; rebuild and reinstall.
Windows may retain pinned shortcut icons until the shortcut is recreated.

Reduced-motion mode displays `app.svg` and stops the rotation timer. The full
color robot stays the same across Light, Dark, and Aura themes; its surrounding
UI follows the selected theme. macOS tints the separate menu-bar template.

Provider logos, upstream attribution logos, ordinary action icons, user uploads,
and content supplied by tools are independent of application branding.
