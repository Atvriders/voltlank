// The VoltLink Express application: API routes, real-time SSE, health,
// metrics, and the built SPA (in production).

import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { env } from './core/env';
import { requestId, csrf, notFound, errorHandler } from './middleware/core';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { providersRouter } from './routes/providers';
import { vehiclesRouter } from './routes/vehicles';
import { commandsRouter } from './routes/commands';
import { drivesRouter } from './routes/drives';
import { chargingRouter } from './routes/charging';
import { analyticsRouter } from './routes/analytics';
import { automationsRouter } from './routes/automations';
import { notificationsRouter } from './routes/notifications';
import { fleetRouter } from './routes/fleet';
import { statusRouter } from './routes/status';
import { adminRouter } from './routes/admin';
import { sseAddClient } from './core/sse';
import { requireAuth } from './auth/middleware';
import { getQueue } from './core/queue';
import { APP_VERSION } from '@voltlink/shared';

export function buildApp(opts: { serveSpa?: boolean } = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(requestId);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path.startsWith('/api/v1/realtime'),
    }),
  );
  app.use('/api', csrf);

  app.get('/healthz', (_req, res) => res.json({ ok: true, version: APP_VERSION, uptimeSec: Math.round(process.uptime()) }));
  app.get('/readyz', async (_req, res) => {
    const ready = await getQueue().ping().catch(() => false);
    res.status(ready ? 200 : 503).json({ ready, version: APP_VERSION });
  });
  app.get('/metrics', (_req, res) => {
    const body = [
      '# HELP voltlank_process_info VoltLink process information',
      `voltlank_process_info{version="${APP_VERSION}",role="${process.env.VL_ROLE ?? 'web'}"} 1`,
      '# HELP voltlank_process_uptime_seconds Process uptime in seconds',
      `voltlank_process_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP voltlank_process_memory_rss_bytes Resident memory in bytes',
      `voltlank_process_memory_rss_bytes ${process.memoryUsage().rss}`,
    ].join('\n');
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(`${body}\n`);
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/providers', providersRouter);
  app.use('/api/v1/vehicles', vehiclesRouter);
  app.use('/api/v1/commands', commandsRouter);
  app.use('/api/v1/drives', drivesRouter);
  app.use('/api/v1/charging', chargingRouter);
  app.use('/api/v1/analytics', analyticsRouter);
  app.use('/api/v1/automations', automationsRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/fleet', fleetRouter);
  app.use('/api/v1/status', statusRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/exports', usersRouter);

  // Real-time events (SSE).
  app.get('/api/v1/realtime', requireAuth, (req, res) => {
    sseAddClient(req.user!.id, res);
  });

  // API root / 404.
  app.use('/api', notFound);

  // Built SPA (production) or dev notice.
  if (opts.serveSpa) {
    const spaDir = path.resolve(process.cwd(), 'web-dist');
    if (fs.existsSync(spaDir)) {
      app.use(express.static(spaDir, { index: false, maxAge: '7d' }));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) {
          next();
          return;
        }
        res.sendFile(path.join(spaDir, 'index.html'));
      });
    }
  }

  app.use(errorHandler);
  return app;
}
