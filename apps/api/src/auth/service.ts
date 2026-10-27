// VoltLink authentication service: accounts, email verification, password
// reset, sessions, TOTP, passkeys (WebAuthn), and the dev/SMTP mailer.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { authenticator } from 'otplib';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { prisma } from '../core/db';
import { env } from '../core/env';
import { hashPassword, verifyPassword, sha256hex, randomToken } from '../core/crypto';
import { audit } from '../core/settings';
import type { UserPublic, SessionInfo } from '@voltlink/shared';

// ---------------------------------------------------------------------------
// Tokens and cookies
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;
  sid: string;
  role: string;
}

export function signSessionJwt(userId: string, sessionId: string, role: string, expiresSec: number): string {
  return jwt.sign({ sub: userId, sid: sessionId, role }, env.JWT_SECRET(), { expiresIn: expiresSec });
}

export function verifySessionJwt(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET()) as JwtPayload;
}

export function tokenHash(token: string): string {
  return sha256hex(token);
}

export function publicUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerifiedAt: Date | null;
  totpEnabled: boolean;
  timezone: string;
  units: string;
  theme: string;
  demoEnabled: boolean;
  presentationMode: boolean;
  createdAt: Date;
}): UserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerified: !!u.emailVerifiedAt,
    totpEnabled: u.totpEnabled,
    passkeyEnabled: false,
    timezone: u.timezone,
    units: u.units === 'imperial' ? 'imperial' : 'metric',
    demoEnabled: u.demoEnabled,
    presentationMode: u.presentationMode,
    createdAt: u.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mailer
// ---------------------------------------------------------------------------

let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter | null {
  if (!env.SMTP_URL) return null;
  if (!transporter) transporter = nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

/** Sends mail when SMTP is configured; otherwise logs it (and returns the
 * link so the developer can click it). Never include links in production
 * responses. */
export async function sendMail(opts: { to: string; subject: string; text: string; html: string }): Promise<{ sent: boolean; detail: string }> {
  const t = getTransporter();
  if (t) {
    await t.sendMail({ from: env.MAIL_FROM, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
    return { sent: true, detail: 'smtp' };
  }
  console.log(`[mail:dev] to=${opts.to} subject="${opts.subject}"\n${opts.text}`);
  return { sent: false, detail: 'logged-to-console' };
}

// ---------------------------------------------------------------------------
// Registration and verification
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const bruteForce = new Map<string, { fails: number; until: number }>();

export function checkBruteForce(key: string): void {
  const e = bruteForce.get(key);
  if (e && e.fails >= 5 && Date.now() < e.until) {
    const wait = Math.ceil((e.until - Date.now()) / 1000);
    throw new AuthError('RATE_LIMITED', `Too many attempts. Try again in ${wait}s.`, 429);
  }
}

export function recordBruteForce(key: string, success: boolean): void {
  if (success) {
    bruteForce.delete(key);
    return;
  }
  const e = bruteForce.get(key) ?? { fails: 0, until: 0 };
  e.fails += 1;
  if (e.fails >= 5) e.until = Date.now() + Math.min(e.fails * 30, 900) * 1000;
  bruteForce.set(key, e);
}

export async function registerUser(input: { email: string; name: string; password: string; role?: string }): Promise<UserPublic> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('INVALID_EMAIL', 'Enter a valid email address.');
  if (input.password.length < 10) throw new AuthError('WEAK_PASSWORD', 'Password must be at least 10 characters.');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AuthError('EMAIL_TAKEN', 'An account with this email already exists.', 409);
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim() || (email.split('@')[0] ?? 'VoltLink user'),
      passwordHash,
      role: input.role && ['OWNER', 'ADMIN'].includes(input.role) ? input.role : 'OWNER',
      timezone: 'UTC',
    },
  });
  await audit({ actorId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id });
  return publicUser(user);
}

export async function createVerification(userId: string): Promise<{ token: string; link: string }> {
  const token = randomToken();
  await prisma.emailVerification.create({
    data: { userId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
  });
  const link = `${env.PUBLIC_URL}/verify-email?token=${token}`;
  return { token, link };
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string }): Promise<{ token: string; link: string; sent: boolean }> {
  const { token, link } = await createVerification(user.id);
  const { sent } = await sendMail({
    to: user.email,
    subject: 'Verify your VoltLink email address',
    text: `Hi ${user.name},\n\nVerify your VoltLink account by opening this link:\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${user.name},</p><p>Verify your VoltLink account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
  });
  return { token, link, sent };
}

export async function verifyEmail(token: string): Promise<void> {
  const hash = tokenHash(token);
  const row = await prisma.emailVerification.findUnique({ where: { tokenHash: hash } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new AuthError('INVALID_TOKEN', 'This verification link is invalid or expired.');
  await prisma.$transaction([
    prisma.emailVerification.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  await audit({ actorId: row.userId, action: 'auth.verify_email', entityType: 'user', entityId: row.userId });
}

// ---------------------------------------------------------------------------
// Login / sessions
// ---------------------------------------------------------------------------

export async function createSession(userId: string, ip?: string, userAgent?: string, label?: string): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const session = await prisma.userSession.create({
    data: {
      userId,
      tokenHash: 'pending',
      ip: ip?.slice(0, 64),
      userAgent: userAgent?.slice(0, 256),
      label: label?.slice(0, 64),
      expiresAt: new Date(Date.now() + env.JWT_EXPIRES_SEC * 1000),
    },
  });
  const token = signSessionJwt(userId, session.id, 'r', env.JWT_EXPIRES_SEC);
  await prisma.userSession.update({ where: { id: session.id }, data: { tokenHash: tokenHash(token) } });
  return { token, sessionId: session.id, expiresAt: session.expiresAt };
}

export async function login(input: { email: string; password: string; totp?: string; ip?: string; userAgent?: string }): Promise<{
  token: string;
  user: UserPublic;
  totpRequired?: boolean;
  totpSession?: string;
}> {
  const email = input.email.trim().toLowerCase();
  checkBruteForce(`login:${email}:${input.ip ?? ''}`);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    recordBruteForce(`login:${email}:${input.ip ?? ''}`, false);
    throw new AuthError('BAD_CREDENTIALS', 'Invalid email or password.', 401);
  }
  if (user.totpEnabled) {
    if (!input.totp) {
      const challenge = randomToken();
      return { token: '', user: publicUser(user), totpRequired: true, totpSession: challenge };
    }
    const ok = authenticator.check(input.totp, user.totpSecret ?? '');
    if (!ok) {
      recordBruteForce(`login:${email}:${input.ip ?? ''}`, false);
      throw new AuthError('BAD_TOTP', 'Invalid authentication code.', 401);
    }
  }
  recordBruteForce(`login:${email}:${input.ip ?? ''}`, true);
  const { token } = await createSession(user.id, input.ip, input.userAgent);
  await audit({ actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip: input.ip });
  return { token, user: publicUser(user) };
}

/** TOTP login continuation: validate code, create session. */
export async function loginWithTotp(email: string, code: string, ip?: string, userAgent?: string): Promise<{ token: string; user: UserPublic }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.totpEnabled) throw new AuthError('BAD_REQUEST', 'TOTP not configured.', 400);
  const ok = authenticator.check(code, user.totpSecret ?? '');
  if (!ok) throw new AuthError('BAD_TOTP', 'Invalid authentication code.', 401);
  const { token } = await createSession(user.id, ip, userAgent);
  await audit({ actorId: user.id, action: 'auth.login_totp', entityType: 'user', entityId: user.id, ip });
  return { token, user: publicUser(user) };
}

export async function listSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]> {
  const rows = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    current: r.id === currentSessionId,
    ip: r.ip ?? '',
    userAgent: r.userAgent ?? '',
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt?.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const row = await prisma.userSession.findUnique({ where: { id: sessionId } });
  if (!row || row.userId !== userId) throw new AuthError('NOT_FOUND', 'Session not found.', 404);
  await prisma.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await audit({ actorId: userId, action: 'auth.revoke_session', entityType: 'session', entityId: sessionId });
}

export async function revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: new Date() },
  });
  await audit({ actorId: userId, action: 'auth.revoke_all_other_sessions' });
}

export async function touchSession(sessionId: string): Promise<void> {
  await prisma.userSession
    .update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; token?: string; link?: string }> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return { ok: true }; // do not reveal account existence
  const token = randomToken();
  await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 3600_000) } });
  const link = `${env.PUBLIC_URL}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your VoltLink password',
    text: `A password reset was requested for your VoltLink account.\nOpen this link to choose a new password:\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>A password reset was requested for your VoltLink account.</p><p><a href="${link}">Choose a new password</a></p><p>If you did not request this, ignore this email.</p>`,
  });
  return { ok: true, token, link };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (newPassword.length < 10) throw new AuthError('WEAK_PASSWORD', 'Password must be at least 10 characters.');
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new AuthError('INVALID_TOKEN', 'This reset link is invalid or expired.');
  await prisma.$transaction([
    prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.userSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ actorId: row.userId, action: 'auth.password_reset', entityType: 'user', entityId: row.userId });
}

// ---------------------------------------------------------------------------
// TOTP setup
// ---------------------------------------------------------------------------

export async function setupTotp(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
  const otpauthUrl = authenticator.keyuri(userId, env.TOTP_ISSUER, secret);
  return { secret, otpauthUrl };
}

export async function confirmTotp(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpSecret) throw new AuthError('NO_TOTP', 'Start TOTP setup first.');
  if (!authenticator.check(code, user.totpSecret)) throw new AuthError('BAD_TOTP', 'Invalid authentication code.');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
  await audit({ actorId: userId, action: 'auth.enable_totp', entityType: 'user', entityId: userId });
  const recoveryCodes = Array.from({ length: 8 }, () => randomToken(6).toUpperCase());
  return { recoveryCodes };
}

export async function disableTotp(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpEnabled || !authenticator.check(code, user.totpSecret ?? '')) throw new AuthError('BAD_TOTP', 'Invalid authentication code.');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null } });
  await audit({ actorId: userId, action: 'auth.disable_totp', entityType: 'user', entityId: userId });
}

export function verifyTotpCode(secret: string | null, code: string): boolean {
  if (!secret) return false;
  return authenticator.check(code, secret);
}

// ---------------------------------------------------------------------------
// Passkeys (WebAuthn)
// ---------------------------------------------------------------------------

export async function webauthnRegistrationOptions(user: { id: string; email: string; name: string }) {
  const existing = await prisma.passkeyCredential.findMany({ where: { userId: user.id } });
  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, type: 'public-key' })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  await prisma.passkeyChallenge.create({
    data: { userId: user.id, challenge: options.challenge, type: 'registration', expiresAt: new Date(Date.now() + 300_000) },
  });
  return options;
}

export async function webauthnVerifyRegistration(userId: string, body: unknown): Promise<void> {
  const challengeRow = await prisma.passkeyChallenge.findFirst({ where: { userId, type: 'registration', expiresAt: { gt: new Date() } }, orderBy: { id: 'desc' } });
  if (!challengeRow) throw new AuthError('NO_CHALLENGE', 'Registration session expired.');
  const verification = await verifyRegistrationResponse({
    response: body as Parameters<typeof verifyRegistrationResponse>[0]['response'],
    expectedChallenge: challengeRow.challenge,
    expectedOrigin: env.PUBLIC_URL,
    expectedRPID: env.WEBAUTHN_RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) throw new AuthError('PASSKEY_FAILED', 'Passkey verification failed.');
  const { credential } = verification.registrationInfo;
  await prisma.passkeyCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: BigInt(credential.counter),
      transports: JSON.parse(JSON.stringify(credential.transports ?? [])),
      name: `Passkey ${new Date().toLocaleDateString()}`,
    },
  });
  await prisma.passkeyChallenge.deleteMany({ where: { userId, type: 'registration' } });
  await audit({ actorId: userId, action: 'auth.add_passkey', entityType: 'user', entityId: userId });
}

export async function webauthnAuthOptions() {
  const options = await generateAuthenticationOptions({ rpID: env.WEBAUTHN_RP_ID, userVerification: 'preferred' });
  return options;
}

export async function webauthnVerifyAuthentication(email: string, body: unknown, ip?: string, userAgent?: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new AuthError('BAD_CREDENTIALS', 'Unknown account.', 401);
  const credential = await prisma.passkeyCredential.findFirst({
    where: { userId: user.id, credentialId: (body as { id?: string }).id },
  });
  if (!credential) throw new AuthError('NO_PASSKEY', 'This passkey is not registered for the account.', 404);
  const challengeRow = await prisma.passkeyChallenge.findFirst({ where: { userId: user.id, type: 'auth', expiresAt: { gt: new Date() } }, orderBy: { id: 'desc' } });
  const verification = await verifyAuthenticationResponse({
    response: body as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
    expectedChallenge: challengeRow?.challenge ?? '',
    expectedOrigin: env.PUBLIC_URL,
    expectedRPID: env.WEBAUTHN_RP_ID,
    credential: { id: credential.credentialId, publicKey: Buffer.from(credential.publicKey, 'base64'), counter: Number(credential.counter), transports: credential.transports as never },
  });
  if (!verification.verified) throw new AuthError('PASSKEY_FAILED', 'Passkey verification failed.', 401);
  await prisma.passkeyCredential.update({ where: { id: credential.id }, data: { counter: BigInt(verification.authenticationInfo.newCounter) } });
  await prisma.passkeyChallenge.deleteMany({ where: { userId: user.id, type: 'auth' } });
  const { token } = await createSession(user.id, ip, userAgent);
  await audit({ actorId: user.id, action: 'auth.passkey_login', entityType: 'user', entityId: user.id, ip });
  return { token, user: publicUser(user) };
}

export async function listPasskeys(userId: string) {
  const rows = await prisma.passkeyCredential.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString() }));
}

export async function deletePasskey(userId: string, passkeyId: string): Promise<void> {
  const row = await prisma.passkeyCredential.findUnique({ where: { id: passkeyId } });
  if (!row || row.userId !== userId) throw new AuthError('NOT_FOUND', 'Passkey not found.', 404);
  await prisma.passkeyCredential.delete({ where: { id: passkeyId } });
  await audit({ actorId: userId, action: 'auth.remove_passkey', entityType: 'user', entityId: userId });
}

/** Re-authentication gate for high-risk actions: password or TOTP. */
export async function stepUpCheck(userId: string, input: { password?: string; totp?: string }): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (input.totp && user.totpEnabled && verifyTotpCode(user.totpSecret, input.totp)) return true;
  if (input.password && (await verifyPassword(user.passwordHash, input.password))) return true;
  return false;
}
