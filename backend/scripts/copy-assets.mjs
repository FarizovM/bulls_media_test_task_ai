import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = join(backendRoot, 'src', 'data');
const destination = join(backendRoot, 'dist', 'data');

mkdirSync(join(backendRoot, 'dist'), { recursive: true });
cpSync(source, destination, { recursive: true, force: true });
