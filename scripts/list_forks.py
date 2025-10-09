#!/usr/bin/env python3
"""Fetch fork information for selected repositories using the GitHub API.

Outputs CSV rows with repo, fork owner, default branch, last commit date,
stars, and notable diffs (files where total changes exceed 200 lines).

Optionally respects a GITHUB_TOKEN environment variable for authenticated
requests to increase rate limits.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import os
import sys
import time
import typing as t
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://api.github.com"
REPOS = [
    ("Systems-Modeling", "SysML-v2-API-Services"),
    ("Systems-Modeling", "SysML-v2-Pilot-Implementation"),
    ("Systems-Modeling", "SysML-v2-Release"),
]
USER_AGENT = "sysml-fork-audit-script"
NOTABLE_THRESHOLD = 200

def api_request(path: str, params: dict[str, t.Any] | None = None) -> t.Any:
    """Perform a GET request to the GitHub API and return the parsed JSON."""

    url = urllib.parse.urljoin(API_BASE, path)
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    }
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(request) as response:
            data = response.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"GitHub API request failed: {exc.code} {exc.reason}\n{message}"
        ) from exc


def paginate(path: str, params: dict[str, t.Any] | None = None) -> t.Iterable[t.Any]:
    """Yield items across paginated GitHub API responses."""

    params = dict(params or {})
    params.setdefault("per_page", 100)
    page = 1
    while True:
        params["page"] = page
        items = api_request(path, params=params)
        if not items:
            break
        yield from items
        if len(items) < params["per_page"]:
            break
        page += 1


def get_repo_info(owner: str, name: str) -> dict[str, t.Any]:
    return api_request(f"/repos/{owner}/{name}")


def list_forks(owner: str, name: str) -> list[dict[str, t.Any]]:
    return list(paginate(f"/repos/{owner}/{name}/forks"))


def compare_branches(
    base_owner: str,
    repo: str,
    base_branch: str,
    fork_owner: str,
    fork_branch: str,
) -> list[str]:
    """Return notable diffs where file changes exceed threshold."""

    try:
        compare = api_request(
            f"/repos/{base_owner}/{repo}/compare/{base_branch}...{fork_owner}:{fork_branch}"
        )
    except RuntimeError as exc:
        # Surface partial information but continue.
        sys.stderr.write(
            f"Warning: compare failed for {fork_owner}/{repo} ({fork_branch}): {exc}\n"
        )
        return []

    files = compare.get("files", []) or []
    notable = []
    for file_info in files:
        changes = file_info.get("changes")
        if changes is None:
            continue
        if changes > NOTABLE_THRESHOLD:
            notable.append(f"{file_info.get('filename')} ({changes})")
    return notable


def parse_datetime(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.fromtimestamp(0, tz=dt.timezone.utc)
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def main() -> int:
    writer = csv.writer(sys.stdout)
    writer.writerow(
        [
            "repo",
            "fork_owner",
            "default_branch",
            "last_commit_date",
            "stars",
            "notable_diffs",
        ]
    )

    for owner, repo in REPOS:
        repo_info = get_repo_info(owner, repo)
        base_branch = repo_info.get("default_branch", "main")
        forks = list_forks(owner, repo)
        # Sort by last update (pushed_at) desc, then stars desc.
        forks.sort(
            key=lambda f: (
                parse_datetime(f.get("pushed_at")),
                f.get("stargazers_count") or 0,
            ),
            reverse=True,
        )

        for fork in forks:
            fork_owner = fork.get("owner", {}).get("login", "")
            default_branch = fork.get("default_branch", "")
            last_commit_date = fork.get("pushed_at") or ""
            stars = fork.get("stargazers_count", 0)
            notable = compare_branches(
                owner,
                repo,
                base_branch,
                fork_owner,
                default_branch or base_branch,
            )

            writer.writerow(
                [
                    f"{owner}/{repo}",
                    fork_owner,
                    default_branch,
                    last_commit_date,
                    stars,
                    "; ".join(notable),
                ]
            )

            # Small delay to stay within secondary rate limits.
            time.sleep(0.1)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
