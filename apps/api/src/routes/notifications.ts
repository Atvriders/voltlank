// Notification routes: in-app list, mark read, preferences, webhook
// endpoints, push subscriptions, and external channel URLs.

import { Router } from 'express';
import { prisma } from '../core/db';
import { requireAuth } from '../auth/middleware';
import { validateWebhookUrl, setUserChannelUrl, userChannelUrl } from '../notifications/simpleWebhooks';
import { sha256hex, randomToken } from '../core/crypto';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const unreadOnly = req.query.unread === 'true';
  const where = { userId: req.user!.id, ...(unreadOnly ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    prisma.appNotification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.appNotification.count({ where }),
    prisma.appNotification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({
    data: {
      items: rows.map((n) => ({
        id: n.id,
        event: n.event,
        severity: n.severity,
        title: n.title,
        body: n.body,
        vehicleId: n.vehicleId ?? undefined,
        vehicleName: n.vehicleName ?? undefined,
        readAt: n.readAt?.toISOString(),
        createdAt: n.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      unread,
    },
  });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const n = await prisma.appNotification.findUnique({ where: { id: req.params.id } });
  if (!n || n.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    return;
  }
  await prisma.appNotification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  res.json({ data: { ok: true } });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.appNotification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ data: { ok: true } });
});

// ---- Preferences ----

notificationsRouter.get('/preferences', async (req, res) => {
  const prefs = await prisma.notificationPreference.findMany({ where: { userId: req.user!.id } });
  const channelUrls: Record<string, string> = {};
  for (const key of ['ntfyUrl', 'gotifyUrl', 'discordWebhook', 'teamsWebhook']) {
    channelUrls[key] = (await userChannelUrl(req.user!.id, key)) ?? '';
  }
  res.json({
    data: {
      prefs: prefs.map((p) => ({ channel: p.channel, event: p.event, severity: p.severity, enabled: p.enabled })),
      channelUrls,
    },
  });
});

notificationsRouter.put('/preferences', async (req, res) => {
  const { channel, event, severity, enabled } = (req.body ?? {}) as { channel?: string; event?: string; severity?: string; enabled?: boolean };
  if (!channel || !event || !severity || typeof enabled !== 'boolean') {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'channel, event, severity, enabled required.' } });
    return;
  }
  await prisma.notificationPreference.upsert({
    where: { userId_channel_event_severity: { userId: req.user!.id, channel, event, severity } },
    update: { enabled },
    create: { userId: req.user!.id, channel, event, severity, enabled },
  });
  res.json({ data: { ok: true } });
});

notificationsRouter.put('/channel-urls', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, string | null>;
  const allowed = ['ntfyUrl', 'gotifyUrl', 'discordWebhook', 'teamsWebhook'];
  for (const key of allowed) {
    if (key in body) {
      const v = body[key];
      if (v && !validateWebhookUrl(v)) {
        res.status(400).json({ error: { code: 'VALIDATION', message: `${key} must be a valid http(s) URL.` } });
        return;
      }
      await setUserChannelUrl(req.user!.id, key, v ?? null);
    }
  }
  res.json({ data: { ok: true } });
});

// ---- Webhook endpoints ----

notificationsRouter.get('/webhooks', async (req, res) => {
  const rows = await prisma.webhookEndpoint.findMany({ where: { userId: req.user!.id }, orderBy: { name: 'asc' } });
  res.json({
    data: rows.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      enabled: w.enabled,
      lastStatus: w.lastStatus ?? undefined,
      lastDeliveryAt: w.lastDeliveryAt?.toISOString(),
    })),
  });
});

notificationsRouter.post('/webhooks', async (req, res) => {
  const { name, url } = (req.body ?? {}) as { name?: string; url?: string };
  if (!name || !url || !validateWebhookUrl(url)) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Name and a valid http(s) URL are required.' } });
    return;
  }
  const secret = randomToken(16);
  const w = await prisma.webhookEndpoint.create({
    data: { userId: req.user!.id, name: name.slice(0, 60), url, secretHash: sha256hex(secret) },
  });
  res.status(201).json({ data: { id: w.id, name: w.name, url: w.url, enabled: w.enabled, secret } });
});

notificationsRouter.patch('/webhooks/:id', async (req, res) => {
  const w = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (!w || w.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Webhook not found.' } });
    return;
  }
  const body = (req.body ?? {}) as { enabled?: boolean };
  await prisma.webhookEndpoint.update({ where: { id: w.id }, data: { enabled: body.enabled ?? w.enabled } });
  res.json({ data: { ok: true } });
});

notificationsRouter.delete('/webhooks/:id', async (req, res) => {
  const w = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (!w || w.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Webhook not found.' } });
    return;
  }
  await prisma.webhookEndpoint.delete({ where: { id: w.id } });
  res.json({ data: { ok: true } });
});

// ---- Push subscriptions (Web Push) ----

notificationsRouter.post('/push-subscribe', async (req, res) => {
  const { endpoint, keys } = (req.body ?? {}) as { endpoint?: string; keys?: Record<string, string> };
  if (!endpoint || !keys) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'endpoint and keys required.' } });
    return;
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { keys: JSON.parse(JSON.stringify(keys)) },
    create: { userId: req.user!.id, endpoint, keys: JSON.parse(JSON.stringify(keys)) },
  });
  res.json({ data: { ok: true } });
});

notificationsRouter.post('/push-unsubscribe', async (req, res) => {
  const { endpoint } = (req.body ?? {}) as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'endpoint required.' } });
    return;
  }
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } });
  res.json({ data: { ok: true } });
});
