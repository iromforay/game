import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const [, , inputArg, outputArg, qualityArg = '0.92'] = process.argv;
if (!inputArg || !outputArg) {
  throw new Error('Usage: node convert-to-webp.mjs <input> <output> [quality]');
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const quality = Number(qualityArg);
const bytes = await readFile(input);
const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});

try {
  const page = await browser.newPage();
  const encoded = await page.evaluate(async ({ source, webpQuality }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', webpQuality).split(',')[1];
  }, { source: dataUrl, webpQuality: quality });
  await writeFile(output, Buffer.from(encoded, 'base64'));
} finally {
  await browser.close();
}
