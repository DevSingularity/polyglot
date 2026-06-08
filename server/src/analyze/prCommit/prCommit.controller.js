export async function createPrCommitController(req, res, next) {
  try {
    const token = req.cookies?.github_token;
    if (!token) {
      const err = new Error('GitHub authentication required to create a PR.');
      err.statusCode = 401;
      throw err;
    }

    const owner = typeof req.body.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body.repo === 'string' ? req.body.repo.trim() : '';
    const path = typeof req.body.path === 'string' ? req.body.path.trim() : '';
    const content = typeof req.body.content === 'string' ? req.body.content : null;
    const sourceBranch = typeof req.body.sourceBranch === 'string' && req.body.sourceBranch ? req.body.sourceBranch : null;
    const targetBranch = typeof req.body.targetBranch === 'string' && req.body.targetBranch ? req.body.targetBranch : null;
    const branch = typeof req.body.branch === 'string' && req.body.branch ? req.body.branch : null;
    const commitMessage = typeof req.body.commitMessage === 'string' ? req.body.commitMessage : `Update ${path} via PolyGlot`;
    const prTitle = typeof req.body.prTitle === 'string' ? req.body.prTitle : `Update ${path}`;
    const prBody = typeof req.body.prBody === 'string' ? req.body.prBody : '';
    const createPullRequest = req.body.createPullRequest !== false;
    const sha = typeof req.body.sha === 'string' && req.body.sha ? req.body.sha : null;

    if (!owner || !repo || !path || content === null) {
      const err = new Error('Missing required parameters: owner, repo, path, content');
      err.statusCode = 400;
      throw err;
    }

    const repoDetails = await (async () => {
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'polyglot',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err = new Error(`GitHub API GET /repos/${owner}/${repo} failed: ${response.status} ${text}`);
        err.statusCode = response.status;
        throw err;
      }

      return response.json();
    })();

    const ghFetch = async (method, apiPath, body) => {
      const url = `https://api.github.com${apiPath}`;
      const resp = await fetch(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'polyglot',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`GitHub API ${method} ${apiPath} failed: ${resp.status} ${text}`);
        err.statusCode = resp.status;
        throw err;
      }
      return resp.json();
    };

    const defaultBranch = repoDetails?.default_branch || 'main';
    const baseBranch = targetBranch || branch || defaultBranch;
    const headBranch = sourceBranch || `${baseBranch}-polyglot-${Date.now()}`;

    if (String(headBranch).toLowerCase() === 'main') {
      const err = new Error('Creating PRs from the main branch is not allowed. Choose or generate a feature branch.');
      err.statusCode = 400;
      throw err;
    }

    const baseCandidates = [...new Set([baseBranch, defaultBranch].filter(Boolean))];

    const getBranchSha = async (branchName) => {
      if (!branchName) return null;
      try {
        const branchRef = await ghFetch('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branchName)}`);
        return branchRef?.object?.sha || null;
      } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
      }
    };

    try {
      const headSha = await getBranchSha(headBranch);
      if (!headSha) {
        let baseSha = null;
        for (const candidate of baseCandidates) {
          baseSha = await getBranchSha(candidate);
          if (baseSha) break;
        }

        if (!baseSha) {
          const err = new Error(
            `Base branch not found. Tried: ${baseCandidates.join(', ') || defaultBranch}. Please pick an existing branch.`,
          );
          err.statusCode = 400;
          throw err;
        }

        await ghFetch('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
          ref: `refs/heads/${headBranch}`,
          sha: baseSha,
        });
      }
    } catch (err) {
      return next(err);
    }

    const encoded = Buffer.from(String(content), 'utf8').toString('base64');
    const putBody = {
      message: commitMessage,
      content: encoded,
      branch: headBranch,
    };
    if (sha) putBody.sha = sha;

    const fileResp = await ghFetch('PUT', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`, putBody);

    let prResp = null;
    if (createPullRequest) {
      prResp = await ghFetch('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
        title: prTitle,
        head: headBranch,
        base: baseBranch,
        body: prBody,
      });
    }

    return res.status(200).json({
      ok: true,
      prUrl: prResp?.html_url || null,
      prNumber: prResp?.number || null,
      savedBranch: headBranch,
      baseBranch,
      file: {
        path: fileResp?.content?.path || path,
        sha: fileResp?.content?.sha || null,
        htmlUrl: fileResp?.content?.html_url || null,
        commitSha: fileResp?.commit?.sha || null,
      },
    });
  } catch (err) {
    return next(err);
  }
}