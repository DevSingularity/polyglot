import { getAuthUser, resolveDatabaseUserId } from '../utils/authUser.js';

export async function requireAuth(req, res, next) {
  const authUser = getAuthUser(req);
  if (!authUser?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const userId = await resolveDatabaseUserId(authUser);
  if (!userId) {
    return res.status(500).json({ error: 'Failed to resolve user record.' });
  }

  req.authUser = authUser;
  req.userId = userId;
  next();
}
