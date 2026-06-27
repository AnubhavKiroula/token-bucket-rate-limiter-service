const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/views');
const destDir = path.join(__dirname, '../dist/views');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.readdirSync(srcDir).forEach(file => {
  const srcFile = path.join(srcDir, file);
  const destFile = path.join(destDir, file);
  fs.copyFileSync(srcFile, destFile);
});

console.log('Successfully copied assets to dist/');
