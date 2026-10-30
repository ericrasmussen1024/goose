#!/usr/bin/env python3
"""Regenerate native application artwork from branding/assets/app.svg.

Requires Pillow and CairoSVG (and its platform Cairo runtime).
Normal application builds use the checked-in exports and need neither tool.
"""

import hashlib
import io
import json
from pathlib import Path
import struct

import cairosvg
from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / 'src' / 'branding' / 'assets'


def main():
    source = ASSETS / 'app.svg'
    rendered = cairosvg.svg2png(
        url=str(source), output_width=2048, output_height=2048,
    )
    original = Image.open(io.BytesIO(rendered)).convert('RGBA')
    original.load()
    generated = []
    manifest = json.loads((ASSETS / 'manifest.json').read_text())
    resampling = (Image.Resampling.NEAREST if manifest['imageRendering'] == 'pixelated'
                  else Image.Resampling.LANCZOS)

    def save(image, name, **options):
        image.save(ASSETS / name, **options)
        generated.append(name)

    def resized(size):
        image = original.copy()
        image.thumbnail((size, size), resampling)
        canvas = Image.new('RGBA', (size, size))
        canvas.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
        return canvas

    for size, name in [(1024, 'app.png'), (2048, 'app@2x.png'), (512, 'app-512.png')]:
        save(resized(size), name)

    ico_sizes = [(size, size) for size in [16, 20, 24, 32, 40, 48, 64, 128, 256]]
    save(resized(256), 'app.ico', sizes=ico_sizes)
    save(resized(256), 'tray.ico', sizes=ico_sizes)

    chunks = []
    for key, size in [(b'icp4', 16), (b'icp5', 32), (b'icp6', 64), (b'ic07', 128),
                      (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024)]:
        png = io.BytesIO()
        resized(size).save(png, format='PNG')
        data = png.getvalue()
        chunks.append(key + struct.pack('>I', len(data) + 8) + data)
    body = b''.join(chunks)
    (ASSETS / 'app.icns').write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)
    generated.append('app.icns')

    def badge(image, template=False):
        image = image.copy()
        size = image.width
        draw = ImageDraw.Draw(image)
        box = (size * .69, 0, size - 1, size * .30)
        draw.ellipse((size * .62, 0, size - 1, size * .38), fill=(0, 0, 0, 0))
        draw.ellipse(box, fill=(0, 0, 0, 255) if template else (223, 55, 59, 255))
        return image

    save(badge(resized(256)), 'tray-update.ico', sizes=ico_sizes)
    for size, suffix in [(32, ''), (64, '@2x')]:
        icon = resized(size)
        save(icon, f'tray{suffix}.png')
        save(badge(icon), f'tray-update{suffix}.png')

    for size, suffix in [(22, ''), (44, '@2x')]:
        image = resized(size)
        # Retain dark robot outlines and face details as a black alpha template.
        # macOS supplies the correct foreground color for its current menu-bar theme.
        mask = Image.new('RGBA', image.size)
        mask.putdata([
            (0, 0, 0, a if (r * 299 + g * 587 + b * 114) < 150000 else 0)
            for r, g, b, a in image.getdata()
        ])
        save(mask, f'trayTemplate{suffix}.png')
        save(badge(mask, template=True), f'tray-updateTemplate{suffix}.png')

    for name, dimensions, logo_size, position in [
        ('installer-sidebar.bmp', (164, 314), 136, (14, 70)),
        ('installer-header.bmp', (150, 57), 48, (6, 4)),
    ]:
        image = Image.new('RGB', dimensions, '#f4f4f2')
        logo = resized(logo_size)
        image.paste(logo, position, logo)
        save(image, name)

    hashes = {name: hashlib.sha256((ASSETS / name).read_bytes()).hexdigest()
              for name in sorted(generated)}
    record = {'source': 'app.svg', 'imageRendering': manifest['imageRendering'],
              'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'exports': hashes}
    (ASSETS / 'generated.json').write_text(json.dumps(record, indent=2) + '\n')
    print(f'Regenerated {len(generated)} exports in {ASSETS}')


if __name__ == '__main__':
    main()
