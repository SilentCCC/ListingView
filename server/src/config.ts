import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(serverRoot, '..');
dotenv.config({ path: path.join(serverRoot, '.env') });

const dataDirValue = process.env.DATA_DIR || path.join(projectRoot, 'data');
export const dataDir = path.isAbsolute(dataDirValue) ? dataDirValue : path.resolve(serverRoot, dataDirValue);
export const uploadsDir = path.join(dataDir, 'uploads');
export const databasePath = path.join(dataDir, 'listing-view.sqlite');
export const port = Number(process.env.PORT || 5172);
export const nodeEnv = process.env.NODE_ENV || 'development';
export const clientDistDir = process.env.CLIENT_DIST_DIR
  ? (path.isAbsolute(process.env.CLIENT_DIST_DIR) ? process.env.CLIENT_DIST_DIR : path.resolve(serverRoot, process.env.CLIENT_DIST_DIR))
  : path.join(projectRoot, 'client', 'dist');
export const maxFileSizeBytes = Math.max(1, Number(process.env.MAX_FILE_SIZE_MB || 10)) * 1024 * 1024;
export const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
export const sqlWasmDir = path.join(serverRoot, 'node_modules', 'sql.js', 'dist');
export const visionApiBaseUrl = process.env.VISION_API_BASE_URL?.trim() || '';
export const visionApiKey = process.env.VISION_API_KEY?.trim() || '';
export const visionModel = process.env.VISION_MODEL?.trim() || '';
export const adminPassword = process.env.ADMIN_PASSWORD?.trim() || '';
