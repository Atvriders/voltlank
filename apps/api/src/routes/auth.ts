// Auth routes: accounts, sessions, verification, reset, TOTP, passkeys.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../core/db';
import { env } from '../core/env';
import { randomToken } from '../core/crypto';
import { requireAuth } from '../auth/middleware';
import {
  registerUser, sendVerificationEmail, verifyEmail, login, loginWithTotp, requestPasswordReset,
  resetPassword, listSessions, revokeSession, revokeAllOtherSessions, setupTotp, confirmTotp,
  disableTotp, verifyTotpCode, webauthnRegistrationOptions, webauthnVerifyRegistration,
  webauthnAuthOptions, webauthnVerifyAuthentication, listPasskeys, deletePasskey, publicUser,
  AuthError, signSessionJwt,
} from '../auth/service';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

const registerSchema = z.object({ email: z.string(), name: z.string().max(80), password: z.string() });
const loginSchema = z.object({ email: z.string(), password: z.string(), totp: z.string().optional() });

function handleAuthError(res: import('express').Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  throw err;
}

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Account unavailable.' } });
    return;
  }
  const passkeys = await prisma.passkeyCredential.count({ where: { userId: user.id } });
  const pub = publicUser(user);
  res.json({ data: { ...pub, passkeyEnabled: passkeys > 0 } });
});

authRouter.get('/csrf', (req, res) => {
  let token = req.cookies?.[env.CSRF_COOKIE_NAME];
  if (typeof token !== 'string' || !token) {
    token = randomToken(16);
    res.cookie(env.CSRF_COOKIE_NAME, token, { httpOnly: false, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: '/' });
  }
  res.json({ data: { token } });
});

authRouter.post('/register', loginLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Check your email, name, and password.' } });
    return;
  }
  try {
    const user = await registerUser(parsed.data);
    // create session so onboarding can continue; verification gates later steps
    const { token } = await (await import('../auth/service')).createSession(user.id, req.ip, req.get('user-agent'));
    const dev = env.NODE_ENV !== 'production' && !env.SMTP_URL;
    const v = await sendVerificationEmail({ id: user.id, email: user.email, name: user.name });
    setSessionCookie(res, token);
    res.status(201).json({
      data: { user, verification: dev ? { token: v.token, link: v.link, note: 'Development mode: link logged to console and returned for local testing only.' } : { sent: v.sent } },
    });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/verify-email', async (req, res) => {
  const { token } = (req.body ?? {}) as { token?: string };
  if (!token) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Missing token.' } });
    return;
  }
  try {
    await verifyEmail(token);
    res.json({ data: { ok: true } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/resend-verification', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  if (user.emailVerifiedAt) {
    res.json({ data: { alreadyVerified: true } });
    return;
  }
  const v = await sendVerificationEmail({ id: user.id, email: user.email, name: user.name });
  const dev = env.NODE_ENV !== 'production' && !env.SMTP_URL;
  res.json({ data: dev ? { token: v.token, link: v.link } : { sent: v.sent } });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Email and password are required.' } });
    return;
  }
  try {
    const result = await login({ ...parsed.data, ip: req.ip, userAgent: req.get('user-agent') });
    if (result.totpRequired) {
      res.json({ data: { totpRequired: true, email: parsed.data.email } });
      return;
    }
    setSessionCookie(res, result.token);
    res.json({ data: { user: result.user } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/login/totp', loginLimiter, async (req, res) => {
  const { email, code } = (req.body ?? {}) as { email?: string; code?: string };
  if (!email || !code) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Email and code required.' } });
    return;
  }
  try {
    const result = await loginWithTotp(email, code, req.ip, req.get('user-agent'));
    setSessionCookie(res, result.token);
    res.json({ data: { user: result.user } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await prisma.userSession.update({ where: { id: req.user!.sessionId }, data: { revokedAt: new Date() } });
  res.clearCookie(env.SESSION_COOKIE);
  res.json({ data: { ok: true } });
});

authRouter.post('/forgot-password', loginLimiter, async (req, res) => {
  const { email } = (req.body ?? {}) as { email?: string };
  if (!email) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Email is required.' } });
    return;
  }
  const result = await requestPasswordReset(email);
  const dev = env.NODE_ENV !== 'production' && !env.SMTP_URL;
  res.json({ data: dev && result.token ? { ok: true, token: result.token, link: result.link } : { ok: true } });
});

authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
  if (!token || !password) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Token and new password required.' } });
    return;
  }
  try {
    await resetPassword(token, password);
    res.json({ data: { ok: true } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await listSessions(req.user!.id, req.user!.sessionId);
  res.json({ data: sessions });
});

authRouter.post('/sessions/:id/revoke', requireAuth, async (req, res) => {
  try {
    await revokeSession(req.user!.id, String(req.params.id));
    res.json({ data: { ok: true } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/sessions/revoke-others', requireAuth, async (req, res) => {
  await revokeAllOtherSessions(req.user!.id, req.user!.sessionId);
  res.json({ data: { ok: true } });
});

// ---- TOTP ----

authRouter.post('/totp/setup', requireAuth, async (req, res) => {
  const { secret, otpauthUrl } = await setupTotp(req.user!.id);
  res.json({ data: { secret, otpauthUrl } });
});

authRouter.post('/totp/confirm', requireAuth, async (req, res) => {
  const { code } = (req.body ?? {}) as { code?: string };
  if (!code) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Code required.' } });
    return;
  }
  try {
    const { recoveryCodes } = await confirmTotp(req.user!.id, code);
    res.json({ data: { ok: true, recoveryCodes } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/totp/disable', requireAuth, async (req, res) => {
  const { code } = (req.body ?? {}) as { code?: string };
  if (!code) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Code required.' } });
    return;
  }
  try {
    await disableTotp(req.user!.id, code);
    res.json({ data: { ok: true } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/stepup', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  const { password, totp } = (req.body ?? {}) as { password?: string; totp?: string };
  let ok = false;
  if (totp && user.totpEnabled) ok = verifyTotpCode(user.totpSecret, totp);
  if (!ok && password) ok = await (await import('../core/crypto')).verifyPassword(user.passwordHash, password);
  if (!ok) {
    res.status(403).json({ error: { code: 'REAUTH_FAILED', message: 'Re-authentication failed.' } });
    return;
  }
  const proof = signSessionJwt(user.id, 'stepup', user.role, 300);
  res.json({ data: { stepUpToken: proof, expiresIn: 300 } });
});

// ---- Passkeys (WebAuthn) ----

authRouter.get('/passkey/register-options', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  try {
    const options = await webauthnRegistrationOptions({ id: user.id, email: user.email, name: user.name });
    res.json({ data: options });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.post('/passkey/register-verify', requireAuth, async (req, res) => {
  try {
    await webauthnVerifyRegistration(req.user!.id, req.body);
    res.json({ data: { ok: true } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.get('/passkey/auth-options', async (req, res) => {
  const options = await webauthnAuthOptions();
  res.json({ data: options });
});

authRouter.post('/passkey/auth-verify', loginLimiter, async (req, res) => {
  const { email, ...body } = (req.body ?? {}) as { email?: string };
  if (!email) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Email required.' } });
    return;
  }
  try {
    const result = await webauthnVerifyAuthentication(email, body, req.ip, req.get('user-agent'));
    setSessionCookie(res, result.token);
    res.json({ data: { user: result.user } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

authRouter.get('/passkeys', requireAuth, async (req, res) => {
  res.json({ data: await listPasskeys(req.user!.id) });
});

authRouter.post('/passkeys/:id/delete', requireAuth, async (req, res) => {
  try {
    await deletePasskey(req.user!.id, String(req.params.id));
    res.json({ data: { ok: true } });
  } catch (err) {
    handleAuthError(res, err);
  }
});

// ---- Challenge endpoint for step-up passkey verification ----
authRouter.get('/passkey/stepup-options', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  await prisma.passkeyChallenge.create({
    data: { userId: user.id, challenge: randomToken(), type: 'auth', expiresAt: new Date(Date.now() + 300_000) },
  });
  res.json({ data: { ok: true } });
});

export function setSessionCookie(res: import('express').Response, token: string): void {
  const isProd = env.NODE_ENV === 'production';
  res.cookie(env.SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: env.JWT_EXPIRES_SEC * 1000,
    path: '/',
  });
}
