import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await copyFile('widget.html', 'dist/widget.html');
