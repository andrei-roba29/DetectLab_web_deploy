import express from 'express';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './logger.js';
import sitesRouter from './routes/sites.js';
import layersRouter from './routes/layers.js';
import clasateRouter from './routes/clasate.js';
import { startScheduler } from './jobs/scheduler.js';

const app = express();

app.use(cors()); // dev-friendly default: allows your React app on any localhost port to call this API
app.use(compression()); // gzip responses - cuts egress costs substantially on large GeoJSON payloads
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', sitesRouter);
app.use('/api', layersRouter);
app.use('/api', clasateRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.port, () => {
  logger.info({ port: env.port }, 'DetectLab API listening');
  startScheduler();
});
