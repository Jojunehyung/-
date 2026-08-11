// 공고별 AI 상담. 런타임 AI = OpenAI (기본 gpt-5-mini, OPENAI_MODEL 환경변수로 교체 가능).
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

const SYSTEM = `너는 1인 소프트웨어 개발사 '더로아' 대표의 영업 참모 AI다.
회사 프로필과 공고 정보를 근거로 대표의 질문에 솔직하고 구체적으로 답한다.
- 투잡 제약(원격, 주 10~15시간, 2~3개월 이내)을 항상 전제로 판단한다.
- 견적·계약의 최종 결정은 대표가 한다. 너는 근거 있는 의견까지만 제시한다.
- 모르는 것은 모른다고 말하고, 공고문에서 확인해야 할 항목을 짚어준다.
- 답변은 간결하게, 동료처럼.`;

export default async (req) => {
  if (!authed(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore("dashboard");

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    const msgs = (await store.get(`chat:${id}`, { type: "json" })) || [];
    return Response.json({ messages: msgs });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY가 Netlify 환경변수에 없습니다. 사이트 설정 → Environment variables에서 추가하세요." },
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
    { role: "system", content: SYSTEM },
    ...history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    { role: "user", content: context },
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5-mini", messages, max_completion_tokens: 1200 }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    return Response.json({ error: `OpenAI 호출 실패 (${resp.status}): ${detail}` }, { status: 502 });
  }
  const out = await resp.json();
  const answer = (out.choices?.[0]?.message?.content || "").trim();

  const now = new Date().toISOString();
  const saved = [...(((await store.get(`chat:${id}`, { type: "json" })) || [])),
    { role: "user", content: question, at: now },
    { role: "ai", content: answer, at: now }];
  await store.setJSON(`chat:${id}`, saved);

  return Response.json({ answer });
};

export const config = { path: "/api/chat" };
