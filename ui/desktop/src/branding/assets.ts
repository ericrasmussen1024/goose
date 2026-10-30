import manifest from './assets/manifest.json';

const urls = import.meta.glob<string>('./assets/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

function svgUrl(filename: string): string {
  const url = urls[`./assets/${filename}`];
  if (!url) throw new Error(`Missing application artwork: ${filename}`);
  return url;
}

export const brandAssets = {
  icon: svgUrl(manifest.icon),
  frames: manifest.frames.map(svgUrl),
  frameMs: manifest.frameMs,
  imageRendering: manifest.imageRendering as 'pixelated' | 'auto',
};
