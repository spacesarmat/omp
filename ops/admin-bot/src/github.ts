// GitHub REST calls of the admin bot. Token: GH_TOKEN, a fine-grained token on spacesarmat/omp only with
// Actions: read and write (workflow runs, workflow_dispatch), Contents: read (gh-pages feeds, monitor-state, releases),
// Issues: read, Metadata: read (stars). Errors never contain the token.
import type { ReleaseInfo, RunInfo } from './format';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHub {
  constructor(
    private token: string,
    private repo: string,
    private doFetch: Fetch,
    private api = 'https://api.github.com',
  ) {}

  private async request(method: string, path: string, opts: { body?: unknown; raw?: boolean } = {}): Promise<Response> {
    const headers: { [k: string]: string } = {
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // the GitHub API refuses requests without a User-Agent
      'User-Agent': 'omp-admin-bot',
    };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await this.doFetch(this.api + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    } catch (e) {
      throw new Error('GitHub ' + path.split('?')[0] + ': нет связи');
    }
    return res;
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.request('GET', '/repos/' + this.repo + path);
    if (!res.ok) throw new Error('GitHub ' + path.split('?')[0] + ': HTTP ' + res.status);
    return (await res.json()) as T;
  }

  /** A file of a branch as text; null when it (or the branch) does not exist. */
  async file(path: string, ref: string): Promise<string | null> {
    const res = await this.request('GET', '/repos/' + this.repo + '/contents/' + path + '?ref=' + encodeURIComponent(ref), { raw: true });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('GitHub ' + path + '@' + ref + ': HTTP ' + res.status);
    return res.text();
  }

  /** Releases, newest first (up to `pages` × 100). */
  async releases(pages = 1): Promise<ReleaseInfo[]> {
    const out: ReleaseInfo[] = [];
    for (let p = 1; p <= pages; p++) {
      const list = await this.json<ReleaseInfo[]>('/releases?per_page=100&page=' + p);
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }

  async repoInfo(): Promise<{ stargazers_count: number; open_issues_count: number }> {
    return this.json('');
  }

  /** Open issues (not pull requests) — the search API counts them exactly; null when it fails. */
  async openIssueCount(): Promise<number | null> {
    const q = encodeURIComponent('repo:' + this.repo + ' is:issue is:open');
    const res = await this.request('GET', '/search/issues?per_page=1&q=' + q);
    if (!res.ok) return null;
    const j = (await res.json()) as { total_count?: number };
    return typeof j.total_count === 'number' ? j.total_count : null;
  }

  async openIssues(label: string): Promise<{ number: number; title: string; html_url: string }[]> {
    const list = await this.json<{ number: number; title: string; html_url: string; pull_request?: unknown }[]>(
      '/issues?state=open&per_page=100&labels=' + encodeURIComponent(label),
    );
    return list.filter((i) => !i.pull_request);
  }

  /** The newest runs of a workflow file (e.g. 'ci.yml'). */
  async runs(workflow: string, q: { branch?: string; event?: string; perPage?: number } = {}): Promise<RunInfo[]> {
    let path = '/actions/workflows/' + workflow + '/runs?per_page=' + (q.perPage || 1);
    if (q.branch) path += '&branch=' + encodeURIComponent(q.branch);
    if (q.event) path += '&event=' + encodeURIComponent(q.event);
    const j = await this.json<{ workflow_runs: RunInfo[] }>(path);
    return j.workflow_runs || [];
  }

  /** workflow_dispatch: inputs are strings (GitHub takes «true»/«false» for boolean inputs). */
  async dispatch(workflow: string, ref: string, inputs: { [k: string]: string }): Promise<void> {
    const path = '/repos/' + this.repo + '/actions/workflows/' + workflow + '/dispatches';
    const res = await this.request('POST', path, { body: { ref, inputs } });
    if (res.status !== 204 && !res.ok) {
      let msg = '';
      try {
        msg = ((await res.json()) as { message?: string }).message || '';
      } catch (e) {
        /* no body */
      }
      throw new Error('GitHub запуск ' + workflow + ': HTTP ' + res.status + (msg ? ' ' + msg : ''));
    }
  }
}
