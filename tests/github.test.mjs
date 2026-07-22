import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseBestRepository,
  extractGitHubCoordinate,
  extractGitHubSearchTerm,
} from "../lib/github.ts";

test("extracts a GitHub repository URL", () => {
  assert.deepEqual(
    extractGitHubCoordinate(
      "学习 https://github.com/datawhalechina/hello-agents 项目",
    ),
    {
      owner: "datawhalechina",
      repo: "hello-agents",
    },
  );
});

test("extracts a repository name from a natural language task", () => {
  assert.equal(
    extractGitHubSearchTerm("学完GitHub上的hello-agent项目"),
    "hello-agent",
  );
});

test("prefers the closest popular repository for an ambiguous name", () => {
  const common = {
    html_url: "https://github.com/example/repo",
    description: null,
    default_branch: "main",
  };
  const selected = chooseBestRepository(
    [
      {
        ...common,
        name: "hello-agent-demo",
        full_name: "example/hello-agent-demo",
        stargazers_count: 100,
      },
      {
        ...common,
        name: "hello-agents",
        full_name: "datawhalechina/hello-agents",
        stargazers_count: 54_000,
      },
      {
        ...common,
        name: "HelloAgents",
        full_name: "example/HelloAgents",
        stargazers_count: 400,
      },
    ],
    "hello-agent",
  );

  assert.equal(selected?.full_name, "datawhalechina/hello-agents");
});
