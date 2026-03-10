import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

// 复制必要的文件
const filesToCopy = [
  { src: '../../dist', dest: 'dist-gateway' },
  { src: '../../node_modules', dest: 'node_modules' },
];

for (const { src, dest } of filesToCopy) {
  const srcPath = path.resolve(__dir, src);
  const destPath = path.resolve(__dir, dest);
  
  if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
    console.log(`Copying ${src} to ${dest}...`);
    execSync(`cp -r "${srcPath}" "${destPath}"`, { stdio: 'inherit' });
  } else if (fs.existsSync(destPath)) {
    console.log(`${dest} already exists, skipping...`);
  }
}
