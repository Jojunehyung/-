// 공고별 AI 상담. 상담 AI = Claude (2026-08 대표 결정: 구현 가능성 판단은 개발 담당의 몫).
// GET  /api/chat?id=공고id            → { messages: [...] }
// POST /api/chat  { id, question }    → { answer }  (대화는 Blobs에 공고별로 저장)
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

const SYSTEM = `너는 1인 소프트웨어 개발사 '더로아'의 개발 책임 AI(Claude)이자 대표의 영업 참모다.
회사 프로필과 공고 정보를 근거로 대표의 질문에 솔직하고 구체적으로 답한다.
- 개발 담당 관점에서 "바이브코딩(AI 고속 개발)으로 실제 구현 가능한가"를 우선 판단한다:
  필요한 기술 요소를 분해하고, AI가 대신 만들 수 있는 부분과 사람 손이 필요한 부분을 구분해 말한다.
- 투잡 제약(원격, 주 10~15시간, 2~3개월 이내)을 항상 전제로 판단한다.
- 견적·계약의 최종 결정은 대표가 한다. 너는 근거 있는 의견까지만 제시한다.
- 모르는 것은 모른다고 말하고, 공고문에서 확인해야 할 항목을 짚어준다.
- 답변은 간결하게, 동료처럼.`;

export default async (req) => {
  if (!authed(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore({ name: "dashboard", consistency: "strong" });

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    const msgs = (await store.get(`chat:${id}`, { type: "json" })) || [];
    return Response.json({ messages: msgs });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY가 Netlify 환경변수에 없습니다. console.anthropic.com에서 키를 발급해 사이트 설정 → Environment variables에 추가하고 재배포하세요." },
      { status: 500 },
    );
  }

  let body = {};
  try { body = await req.json(); } catch { /* noop */ }
  const { id, question } = body;
  if (!id || !question) return Response.json({ error: "bad request" }, { status: 400 });

  const data = (await store.get("opps", { type: "json" })) || { items: {} };
  const opp = data.items[id];
  if (!opp) return Response.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });

  const profile = (await store.get("profile", { type: "json" })) || {};
  const history = ((await store.get(`chat:${id}`, { type: "json" })) || []).slice(-10);

  const context = [
    "## 회사 프로필", JSON.stringify(profile),
    "## 공고 정보", JSON.stringify({ title: opp.title, org: opp.org, budget_manwon: opp.budget_manwon, deadline: opp.deadline, source: opp.source, url: opp.url }),
    "## 기존 AI 분석", JSON.stringify(opp.analysis || {}),
    "## 대표의 질문", question,
  ].join("\n");

  const messages = [
    ...history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    { role: "user", content: context },
  ];

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 1200,
      system: SYSTEM,
      messages,
    }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    return Response.json({ error: `Claude 호출 실패 (${resp.status}): ${detail}` }, { status: 502 });
  }
  const out = await resp.json();
  const answer = (out.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const now = new Date().toISOString();
  const saved = [...(((await store.get(`chat:${id}`, { type: "json" })) || [])),
    { role: "user", content: question, at: now },
    { role: "ai", content: answer, at: now }];
  await store.setJSON(`chat:${id}`, saved);

  return Response.json({ answer });
};

export const config = { path: "/api/chat" };
