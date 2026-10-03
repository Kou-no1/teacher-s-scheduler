import { copyFile } from 'node:fs/promises';

await copyFile(new URL('../index.html', import.meta.url), new URL('../gas/Index.html', import.meta.url));
console.log('gas/Index.html generated from index.html');
