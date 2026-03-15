const fs = require('fs');
const path = require('path');

// --- Configuration ---

// The name of the output file.
const outputFile = 'full_code.txt';

// The root directory of your project. '.' means the current directory.
const rootDir = '.';

// List of directories to completely ignore.
const ignoreDirs = [
  'node_modules',
  '.next',
  '.git',
  '.vscode',
  '.swc',
  'dist',
  'build',
  'temp'
  // Add any other directories you want to ignore
];

// List of specific files or file extensions to ignore.
const ignoreFiles = [
  outputFile,          // Don't include the output file itself
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig.tsbuildinfo',
  '.env',
  '.env.local',
  // Add any other specific files you want to ignore
];

const ignoreExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', // Images
    '.woff', '.woff2', '.ttf', '.eot', // Fonts
    '.mp4', '.webm', // Videos
    '.zip', '.gz', // Archives
];


// --- Script Logic ---

let finalContent = '';

function walkDir(currentPath) {
  const files = fs.readdirSync(currentPath);

  for (const file of files) {
    const filePath = path.join(currentPath, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // If it's a directory, check if it's in the ignore list.
      if (!ignoreDirs.includes(file)) {
        // If not ignored, recurse into it.
        walkDir(filePath);
      }
    } else {
      // It's a file. Check if it or its extension is in the ignore lists.
      const fileExtension = path.extname(file).toLowerCase();
      if (!ignoreFiles.includes(file) && !ignoreExtensions.includes(fileExtension)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          
          finalContent += `// FILE: ${filePath}\n`;
          finalContent += `// --------------------------------------------------------------------------\n\n`;
          finalContent += content;
          finalContent += `\n\n// END OF FILE: ${filePath}\n`;
          finalContent += `// ==========================================================================\n\n`;

        } catch (error) {
            // This can happen for binary files that aren't caught by the extension filter
            console.log(`Could not read file (likely binary): ${filePath}`);
        }
      }
    }
  }
}

try {
  console.log('Starting to bundle project files...');
  // Start the process from the root directory.
  walkDir(rootDir);

  // Write the aggregated content to the output file.
  fs.writeFileSync(outputFile, finalContent);

  console.log(`✅ Successfully created ${outputFile}`);
  console.log('Remember to review the file for any sensitive information before sharing.');

} catch (error) {
  console.error('❌ An error occurred:', error);
}