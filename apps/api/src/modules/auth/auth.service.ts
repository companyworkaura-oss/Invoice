import { config } from '../../config.js';
import { pool, withTransaction } from '../../db/pool.js';
import { conflict, unauthorized } from '../../lib/http-error.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { hashToken, newToken } from '../../lib/token.js';

export interface NewSession {
  token: string;
  expiresAt: Date;
}

// Compared against when the email is unknown so login timing does not reveal which emails exist.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

async function createSession(
  q: { query: typeof pool.query },
  userId: string,
  companyId: string,
): Promise<NewSession> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await q.query('INSERT INTO sessions (token_hash, user_id, company_id, expires_at) VALUES ($1, $2, $3, $4)', [
    hashToken(token),
    userId,
    companyId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function register(input: {
  companyName: string;
  fullName: string;
  email: string;
  password: string;
}): Promise<NewSession> {
  const passwordHash = await hashPassword(input.password);
  return withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [input.email]);
    if (existing.rowCount) throw conflict('An account with this email already exists');

    const company = await client.query<{ id: string }>('INSERT INTO companies (name) VALUES ($1) RETURNING id', [
      input.companyName,
    ]);
    const user = await client.query<{ id: string }>(
      'INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [input.email, input.fullName, passwordHash],
    );
    const companyId = company.rows[0].id;
    const userId = user.rows[0].id;
    await client.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      companyId,
      userId,
    ]);
    return createSession(client, userId, companyId);
  });
}

export async function login(email: string, password: string): Promise<NewSession> {
  const { rows } = await pool.query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE lower(email) = $1',
    [email],
  );
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');

  // Default to the oldest membership; company switching can come later.
  const membership = await pool.query<{ company_id: string }>(
    'SELECT company_id FROM company_members WHERE user_id = $1 ORDER BY created_at LIMIT 1',
    [user.id],
  );
  if (!membership.rows[0]) throw unauthorized('Account has no company access');
  return createSession(pool, user.id, membership.rows[0].company_id);
}

export async function logout(sessionId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function getMe(userId: string, companyId: string) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name AS "fullName", m.role,
            json_build_object('id', c.id, 'name', c.name, 'currencyCode', c.currency_code) AS company
       FROM users u
       JOIN company_members m ON m.user_id = u.id AND m.company_id = $2
       JOIN companies c ON c.id = m.company_id
      WHERE u.id = $1`,
    [userId, companyId],
  );
  if (!rows[0]) throw unauthorized();
  return rows[0];
}
