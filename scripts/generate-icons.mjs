/**
 * Resize script: takes the source 512x512 icon and generates
 * all PWA icon sizes required by the manifest.webmanifest.
 *
 * Run with: node scripts/generate-icons.mjs
 */

import { Jimp } from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path to the source icon (place your 512x512 PNG here)
const SOURCE_ICON = path.resolve(__dirname, '../src/assets/icons/icon-source.png');

// Output directory — same folder as the source
const OUTPUT_DIR = path.resolve(__dirname, '../src/assets/icons');

// All sizes required by the manifest
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  console.log(`Reading source icon: ${SOURCE_ICON}`);

  // Jimp.read loads the image into memory so we can manipulate it
  const image = await Jimp.read(SOURCE_ICON);

  for (const size of SIZES) {
    const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);

    // .clone() so we don't mutate the original image between iterations
    await image
      .clone()
      .resize({ w: size, h: size }) // Jimp 1.x uses object syntax for resize
      .write(outputPath);

    console.log(`✅ Generated: icon-${size}x${size}.png`);
  }

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
