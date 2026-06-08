import path from 'path';

export function inferRepositoryName({ source, fullName, githubRepo }) {
  if (githubRepo) return githubRepo;
  if (!fullName) return source === 'local' ? 'Local repository' : 'Unknown repository';

  if (source === 'local') {
    const normalized = String(fullName).replace(/\\/g, '/');
    return path.posix.basename(normalized) || 'Local repository';
  }

  const parts = String(fullName).split('/').filter(Boolean);
  return parts[1] || parts[0] || 'Unknown repository';
}

export function inferRepositoryOwner({ source, fullName, githubOwner }) {
  if (githubOwner) return githubOwner;
  if (source === 'local') return 'local';

  const parts = String(fullName || '').split('/').filter(Boolean);
  return parts[0] || 'unknown';
}

export default { inferRepositoryName, inferRepositoryOwner };
