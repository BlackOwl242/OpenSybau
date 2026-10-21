export async function listWorkspaceGithubIssues(cwd, runFn) {
  const versionCheck = await runFn("gh", ["--version"], { cwd, timeout: 6000 });
  if (versionCheck.code !== 0) {
    return {
      available: false,
      authenticated: false,
      issues: [],
      prs: [],
      message: "Chưa cài đặt GitHub CLI (gh) trên máy.",
    };
  }
  const authCheck = await runFn("gh", ["auth", "status"], { cwd, timeout: 8000 });
  if (authCheck.code !== 0) {
    return {
      available: true,
      authenticated: false,
      issues: [],
      prs: [],
      message: "GitHub CLI (gh) chưa đăng nhập. Hãy chạy `gh auth login` trong terminal.",
    };
  }

  const [issuesRes, prsRes] = await Promise.all([
    runFn(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "20",
        "--json",
        "number,title,body,labels,url,updatedAt,author",
      ],
      { cwd, timeout: 12000 }
    ),
    runFn(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "15",
        "--json",
        "number,title,headRefName,baseRefName,url,updatedAt,author,isDraft",
      ],
      { cwd, timeout: 12000 }
    ),
  ]);

  let issues = [];
  let prs = [];
  if (issuesRes.code === 0 && issuesRes.stdout) {
    try {
      const parsed = JSON.parse(issuesRes.stdout);
      if (Array.isArray(parsed)) {
        issues = parsed.map((item) => ({
          number: item.number,
          title: String(item.title || "").slice(0, 180),
          body: String(item.body || "").slice(0, 1600),
          url: String(item.url || ""),
          updatedAt: item.updatedAt || "",
          author: item.author?.login || "",
          labels: Array.isArray(item.labels) ? item.labels.map((l) => l?.name).filter(Boolean) : [],
        }));
      }
    } catch {}
  }
  if (prsRes.code === 0 && prsRes.stdout) {
    try {
      const parsed = JSON.parse(prsRes.stdout);
      if (Array.isArray(parsed)) {
        prs = parsed.map((item) => ({
          number: item.number,
          title: String(item.title || "").slice(0, 180),
          headRefName: String(item.headRefName || ""),
          baseRefName: String(item.baseRefName || ""),
          url: String(item.url || ""),
          updatedAt: item.updatedAt || "",
          author: item.author?.login || "",
          isDraft: Boolean(item.isDraft),
        }));
      }
    } catch {}
  }

  const repoError = issuesRes.code !== 0 && prsRes.code !== 0
    ? String(issuesRes.stderr || prsRes.stderr || "Repository này chưa kết nối GitHub remote.").trim().slice(0, 260)
    : "";

  return {
    available: true,
    authenticated: true,
    issues,
    prs,
    message: repoError,
  };
}

export async function createTaskGithubPullRequest(cwd, { title, body, baseBranch = "", draft = false }, runFn, gitFn) {
  const cleanTitle = String(title || "").trim().slice(0, 180);
  if (!cleanTitle) throw new Error("Nhập tiêu đề Pull Request.");
  const cleanBody = String(body || "").trim().slice(0, 12_000);

  const branchRes = await gitFn(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = branchRes.code === 0 ? branchRes.stdout.trim() : "";
  if (!currentBranch || currentBranch === "HEAD") {
    throw new Error("Không xác định được nhánh Git hiện tại để tạo Pull Request.");
  }

  const pushRes = await gitFn(cwd, ["push", "-u", "origin", currentBranch]);
  if (pushRes.code !== 0) {
    throw new Error((pushRes.stderr || pushRes.stdout || "Không thể đẩy nhánh lên origin.").trim().slice(0, 400));
  }

  const args = ["pr", "create", "--title", cleanTitle, "--body", cleanBody || cleanTitle];
  if (baseBranch && /^[a-zA-Z0-9._/-]{1,120}$/.test(baseBranch)) {
    args.push("--base", baseBranch);
  }
  if (draft) {
    args.push("--draft");
  }
  const prRes = await runFn("gh", args, { cwd, timeout: 25000 });
  if (prRes.code !== 0) {
    throw new Error((prRes.stderr || prRes.stdout || "Không thể tạo Pull Request bằng GitHub CLI.").trim().slice(0, 400));
  }
  const out = `${prRes.stdout}\n${prRes.stderr}`.trim();
  const urlMatch = out.match(/https:\/\/github\.com\/[^\s]+/);
  return {
    ok: true,
    branch: currentBranch,
    url: urlMatch ? urlMatch[0] : "",
    output: out.slice(0, 400),
  };
}
