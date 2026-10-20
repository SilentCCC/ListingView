import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { clientDistDir, corsOrigin, nodeEnv, port, uploadsDir } from './config.js';
import { initDatabase } from './db.js';
import routes from './routes.js';

await initDatabase();
const app = express();
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadsDir, { maxAge: nodeEnv === 'production' ? '7d' : 0, index: false }));
app.use('/api', routes);
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/') || request.path.startsWith('/uploads/')) return next();
    response.sendFile(path.join(clientDistDir, 'index.html'));
  });
}
app.use((error: any, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = Number(error?.status) || (error?.code === 'LIMIT_FILE_SIZE' ? 413 : error?.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : 500);
  const message = error?.code === 'LIMIT_FILE_SIZE' ? '图片大小超过限制' : error?.message || '服务器内部错误';
  if (status >= 500) console.error(error);
  response.status(status).json({ error: message });
});
app.listen(port, () => {
  console.log(`ListingView server listening on http://localhost:${port}`);
  console.log(`Data directory: ${path.resolve(uploadsDir, '..')}`);
});
export default app;
