const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [
  { name: 'small', width: 250, height: 175 },
  { name: 'large', width: 500, height: 350 },
  { name: 'xlarge', width: 1000, height: 700 }
];

async function convertIcons() {
  for (const size of sizes) {
    const svgPath = path.join(__dirname, 'assets', 'images', `${size.name}.svg`);
    const pngPath = path.join(__dirname, 'assets', 'images', `${size.name}.png`);

    console.log(`Converting ${size.name}.svg to PNG...`);

    await sharp(svgPath)
      .resize(size.width, size.height)
      .png()
      .toFile(pngPath);

    console.log(`✓ Created ${size.name}.png`);
  }

  console.log('\nAll icons converted successfully!');
}

convertIcons().catch(err => {
  console.error('Error converting icons:', err);
  process.exit(1);
});
