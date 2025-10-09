#!/usr/bin/env python3
"""List forks of selected SysML-v2 repositories and output CSV."""

from __future__ import annotations

import csv
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Iterable, List, Optional

UPSTREAM_OWNER = "SysML-v2"
REPOSITORIES = [
    "SysML-v2-API-Services",
    "SysML-v2-Pilot-Implementation",
    "SysML-v2-Release",
]

API_ROOT = "https://api.github.com"
DEFAULT_HEADERS = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "sysml-v2-fork-analyzer",
}


class GitHubClient:
    """Minimal GitHub API client using urllib."""

    def __init__(self, token: Optional[str] = None) -> None:
        self.headers = dict(DEFAULT_HEADERS)
        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    def request(self, url: str, params: Optional[Dict] = None) -> tuple[Dict, Dict[str, str]]:
        if params:
            query = urllib.parse.urlencode(params)
            separator = "&" if urllib.parse.urlparse(url).query else "?"
            url = f"{url}{separator}{query}"
        req = urllib.request.Request(url, headers=self.headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read()
            data = json.loads(content.decode("utf-8"))
            headers = {k: v for k, v in resp.headers.items()}
            return data, headers

    def get(self, url: str, params: Optional[Dict] = None) -> Dict:
        data, _ = self.request(url, params=params)
        return data

    def paginate(self, url: str, params: Optional[Dict] = None) -> Iterable[Dict]:
        next_url = url
        next_params = dict(params or {})
        while next_url:
            data, headers = self.request(next_url, params=next_params)
            if not isinstance(data, list):
                raise ValueError("Expected list response for pagination")
            for item in data:
                yield item

            link_header = headers.get("Link", "")
            next_url = None
            if link_header:
                parts = [part.strip() for part in link_header.split(",")]
                for part in parts:
                    segment = part.split(";")
                    if len(segment) < 2:
                        continue
                    link_part = segment[0].strip()
                    rel_part = segment[1].strip()
                    if rel_part == 'rel="next"':
                        next_url = link_part.strip("<>")
                        break
            next_params = None


def iso_to_datetime(iso_str: str) -> dt.datetime:
    return dt.datetime.fromisoformat(iso_str.replace("Z", "+00:00"))


def collect_fork_data(client: GitHubClient) -> List[Dict]:
    results: List[Dict] = []
    for repo_name in REPOSITORIES:
        upstream = client.get(f"{API_ROOT}/repos/{UPSTREAM_OWNER}/{repo_name}")
        upstream_default_branch = upstream["default_branch"]

        forks = client.paginate(
            f"{API_ROOT}/repos/{UPSTREAM_OWNER}/{repo_name}/forks",
            params={"per_page": 100, "sort": "stargazers"},
        )

        for fork in forks:
            fork_owner = fork["owner"]["login"]
            default_branch = fork.get("default_branch") or "main"
            stars = fork.get("stargazers_count", 0)

            branch_url = (
                f"{API_ROOT}/repos/{fork_owner}/{fork['name']}/branches/{default_branch}"
            )
            try:
                branch_info = client.get(branch_url)
                commit_date = branch_info["commit"]["commit"]["committer"]["date"]
            except urllib.error.HTTPError:
                commit_date = ""

            notable_diffs: List[str] = []
            compare_url = (
                f"{API_ROOT}/repos/{UPSTREAM_OWNER}/{repo_name}/compare/"
                f"{upstream_default_branch}...{fork_owner}:{default_branch}"
            )
            try:
                comparison = client.get(compare_url)
                for file_info in comparison.get("files", []):
                    if file_info.get("changes", 0) > 200:
                        notable_diffs.append(file_info.get("filename", ""))
            except urllib.error.HTTPError:
                notable_diffs = ["<compare failed>"]

            results.append(
                {
                    "repo": repo_name,
                    "fork_owner": fork_owner,
                    "default_branch": default_branch,
                    "last_commit_date": commit_date,
                    "stars": stars,
                    "notable-diffs": ";".join(notable_diffs),
                }
            )
    return results


def main() -> int:
    token = os.getenv("GITHUB_TOKEN")
    client = GitHubClient(token=token)

    try:
        data = collect_fork_data(client)
    except urllib.error.HTTPError as exc:
        print(f"GitHub API request failed: {exc}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Network error: {exc}", file=sys.stderr)
        return 1

    def sort_key(item: Dict) -> tuple:
        date_str = item.get("last_commit_date")
        if date_str:
            date = iso_to_datetime(date_str)
        else:
            date = dt.datetime.min.replace(tzinfo=dt.timezone.utc)
        return (-date.timestamp(), -item.get("stars", 0))

    data.sort(key=sort_key)

    writer = csv.DictWriter(
        sys.stdout,
        fieldnames=[
            "repo",
            "fork_owner",
            "default_branch",
            "last_commit_date",
            "stars",
            "notable-diffs",
        ],
    )
    writer.writeheader()
    for row in data:
        writer.writerow(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
