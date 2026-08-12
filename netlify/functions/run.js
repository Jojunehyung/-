// POST /api/run { dept } → GitHub Actions workflow_dispatch (원격 실행)
// 필요 환경변수: GITHUB_TOKEN(fine-grained PAT, Actions 쓰기), GITHUB_REPO("아이디/저장소")
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

function authed(req) {
  const t = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const [exp, sig] = t.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const pw = process.env.ADMIN_PASSWORD || "";
  const good = createHmac("sha256", process.env.AUTH_SECRET || pw).update(exp).digest("base64url");
  try { return timingSafeEqual(Buffer.from(sig), Buffer.from(good)); } catch { return false; }
}

const WORKFLOWS = { lead: "collect.yml" }; // 부서 → 워크플로 파일 (가동 부서가 늘면 추가)

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!authed(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch { /* noop */ }
  const wf = WORKFLOWS[body.dept];
  if (!wf) return Response.json({ error: "아직 가동 전인 부서입니다." }, { status: 400 });

  const ghToken = process.env.GITHUB_TOKEN || "";
  const repo = process.env.GITHUB_REPO || "";
  if (!ghToken || !repo) {
    return Response.json(
      { error: "GITHUB_TOKEN / GITHUB_REPO 환경변수가 없습니다. README-DEPLOY의 '콘솔 연동'을 참고하세요." },
      { status: 500 },
    );
  }

  const store = getStore("dashboard");
  const lock = await store.get(`runlock:${body.dept}`, { type: "json" });
  if (lock && Date.now() - lock.t < 60000) {
    return Response.json({ error: "1분에 한 번만 실행할 수 있어요. 잠시 후 다시 시도하세요." }, { status: 429 });
  }

  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "theroa-console",
    },
    body: JSON.stringify({ ref: process.env.GITHUB_BRANCH || "main" }),
  });
  if (r.status !== 204) {
    const detail = (await r.text()).slice(0, 200);
    return Response.json({ error: `GitHub 호출 실패 (${r.status}): ${detail}` }, { status: 502 });
  }

  await store.setJSON(`runlock:${body.dept}`, { t: Date.now() });
  return Response.json({ ok: true });
};

export const config = { path: "/api/run" };
