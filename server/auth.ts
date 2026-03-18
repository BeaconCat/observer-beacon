import bcrypt from 'bcryptjs';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const RAW_PASSWORD = (process.env.OBSERVER_PASSWORD || 'pl3ase_ch@nge_m3').trim();
const PASSWORD_HASH = bcrypt.hashSync(RAW_PASSWORD, 12);

const limiter = new RateLimiterMemory({
  points: 5,
  duration: 900,
  blockDuration: 900,
});

export async function verifyPassword(password: string, ip: string): Promise<{ ok: boolean; error?: string }> {
  if (!password || typeof password !== 'string' || password.length > 100) {
    return { ok: false, error: 'Invalid input' };
  }

  try {
    await limiter.consume(ip);
  } catch {
    return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' };
  }

  await new Promise(r => setTimeout(r, 500));

  const match = bcrypt.compareSync(password, PASSWORD_HASH);
  if (!match) {
    return { ok: false, error: 'Wrong password' };
  }

  try { await limiter.delete(ip); } catch {}
  return { ok: true };
}
