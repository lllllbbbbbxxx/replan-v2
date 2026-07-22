export type GitHubSource = {
  type: "github";
  name: string;
  url: string;
};

type GitHubRepository = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
};

type GitHubSearchResponse = {
  items?: GitHubRepository[];
};

type GitHubTreeResponse = {
  tree?: Array<{
    path?: string;
    type?: string;
  }>;
};

export type GitHubContext = {
  source: GitHubSource;
  promptContext: string;
};

const GITHUB_URL =
  /https?:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)/i;

function normalizeRepoName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function singularRepoName(value: string) {
  return normalizeRepoName(value).replace(/s$/, "");
}

export function extractGitHubCoordinate(text: string) {
  const match = text.match(GITHUB_URL);
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ""),
  };
}

export function extractGitHubSearchTerm(text: string) {
  const match = text.match(
    /github(?:\s*上(?:\s*的)?)?[\s:：\-—]*([a-z0-9][a-z0-9_.-]{1,80})/i,
  );
  return match?.[1]?.replace(/(?:项目|仓库)$/i, "") ?? null;
}

export function chooseBestRepository(
  repositories: GitHubRepository[],
  searchTerm: string,
) {
  const target = normalizeRepoName(searchTerm);
  const singularTarget = singularRepoName(searchTerm);

  return [...repositories].sort((left, right) => {
    const score = (repo: GitHubRepository) => {
      const name = normalizeRepoName(repo.name);
      const singularName = singularRepoName(repo.name);
      let relevance = 0;

      if (name === target) relevance += 1_000;
      else if (singularName === singularTarget) relevance += 900;
      else if (name.includes(target) || target.includes(name)) relevance += 600;

      return relevance + Math.log2(repo.stargazers_count + 1);
    };

    return score(right) - score(left);
  })[0];
}

function githubHeaders(accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "replan-mvp",
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchGitHubJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function resolveRepository(text: string) {
  const coordinate = extractGitHubCoordinate(text);
  if (coordinate) {
    return fetchGitHubJson<GitHubRepository>(
      `/repos/${encodeURIComponent(coordinate.owner)}/${encodeURIComponent(coordinate.repo)}`,
    );
  }

  const searchTerm = extractGitHubSearchTerm(text);
  if (!searchTerm) return null;

  const results = await fetchGitHubJson<GitHubSearchResponse>(
    `/search/repositories?q=${encodeURIComponent(`${searchTerm} in:name`)}&sort=stars&order=desc&per_page=8`,
  );
  return chooseBestRepository(results?.items ?? [], searchTerm) ?? null;
}

function cleanReadme(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/<picture[\s\S]*?<\/picture>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 24_000);
}

function usefulTreePaths(tree: GitHubTreeResponse["tree"]) {
  const preferred = /(^|\/)(docs?|chapters?|examples?|src|lib|packages?)(\/|$)/i;
  const usefulFile = /\.(md|mdx|py|ts|tsx|js|jsx|json|ya?ml)$/i;

  return (tree ?? [])
    .filter((item) => {
      if (!item.path || item.type !== "blob") return false;
      if (/node_modules|\.lock$|assets?|images?|public\//i.test(item.path)) {
        return false;
      }
      const depth = item.path.split("/").length;
      return (
        /(^|\/)readme[^/]*\.md$/i.test(item.path) ||
        (usefulFile.test(item.path) && (depth <= 2 || preferred.test(item.path)))
      );
    })
    .map((item) => item.path as string)
    .slice(0, 140);
}

export async function getGitHubContext(text: string): Promise<GitHubContext | null> {
  if (!/github(?:\.com)?/i.test(text)) return null;

  const repository = await resolveRepository(text);
  if (!repository) return null;

  const repoPath = repository.full_name
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const [readmeResponse, tree] = await Promise.all([
    fetch(`https://api.github.com/repos/${repoPath}/readme`, {
      headers: githubHeaders("application/vnd.github.raw+json"),
      signal: AbortSignal.timeout(6_000),
    }).catch(() => null),
    fetchGitHubJson<GitHubTreeResponse>(
      `/repos/${repoPath}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
    ),
  ]);

  const readme =
    readmeResponse?.ok === true ? cleanReadme(await readmeResponse.text()) : "";
  const paths = usefulTreePaths(tree?.tree);

  return {
    source: {
      type: "github",
      name: repository.full_name,
      url: repository.html_url,
    },
    promptContext: [
      "【GitHub 仓库资料】",
      `仓库：${repository.full_name}`,
      repository.description ? `项目简介：${repository.description}` : "",
      readme ? `README 摘录：\n${readme}` : "",
      paths.length ? `相关目录与文件：\n${paths.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
