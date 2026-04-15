import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DATA_DIR: string = process.env['DATA_DIR']
  ?? join(homedir(), '.matvareplanlegger');

export const DB_PATH = join(DATA_DIR, 'data.db');
export const SESSION_PATH = join(DATA_DIR, 'oda-session.json');
export const MIGRATIONS_DIR = join(__dirname, '../../src/db/migrations');
