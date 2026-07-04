#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconDir = path.join(root, 'assets', 'icon');
const svgPath = path.join(iconDir, 'hexwright.svg');
const iconSet = path.join(iconDir, 'hexwright.iconset');

const svg = fs.readFileSync(svgPath, 'utf8');
const svgBody = svg.replace(/<\?xml[^?]*\?\u003e/g, '').trim();

const sizes = [16, 32, 64, 128, 256, 512, 1024];

const iconSetMap = {
  16:  'icon_16x16.png',
  32:  'icon_16x16@2x.png',
  64:  'icon_32x32@2x.png',
  128: 'icon_128x128.png',
  256: ['icon_128x128@2x.png', 'icon_256x256.png'],
  512: ['icon_256x256@2x.png', 'icon_512x512.png'],
  1024:'icon_512x512@2x.png',
};

fs.mkdirSync(iconSet, { recursive: true });

const browser = await chromium.launch();

for (const size of sizes) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });

  const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:transparent;">
    <div style="width:${size}px;height:${size}px;">${svgBody}</div>
  </body>
</html>`;

  await page.setContent(html, { waitUntil: 'networkidle' });

  const outPng = path.join(iconDir, `hexwright-${size}.png`);
  await page.screenshot({
    type: 'png',
    omitBackground: true,
    path: outPng,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log(`rendered ${outPng}`);

  const iconSetNames = iconSetMap[size];
  if (iconSetNames) {
    for (const name of Array.isArray(iconSetNames) ? iconSetNames : [iconSetNames]) {
      fs.copyFileSync(outPng, path.join(iconSet, name));
    }
  }

  await page.close();
}

await browser.close();

const icnsPath = path.join(iconDir, 'hexwright.icns');
try {
  execSync(`iconutil -c icns "${iconSet}" -o "${icnsPath}"`, { stdio: 'inherit' });
  console.log(`created ${icnsPath}`);
} catch (err) {
  console.error('iconutil failed:', err.message);
  process.exit(1);
}
