// POST /api/auth  { password } → { token }
// 토큰 = 만료시각.HMAC서명 (30일). ADMIN_PASSWORD / AUTH_SECRET 은 Netlify 환경변수.
import { createHmac } from "node:crypto";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const pw = process.env.ADMIN_PASSWORD || "";
  if (!pw) {
    return Response.json(
      { error: "서버에 ADMIN_PASSWORD 환경변수가 설정되지 않았습니다. Netlify 사이트 설정에서 추가하세요." },
      { status: 500 },
    );
  }

  let body = {};
  try { body = await req.json(); } catch { /* 빈 본문 */ }
  if ((body.password || "") !== pw) {
    return Response.json({ error: "비밀번호가 다릅니다." }, { status: 401 });
  }

  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30일
  const sig = createHmac("sha256", process.env.AUTH_SECRET || pw)
    .update(String(exp))
    .digest("base64url");
  return Response.json({ token: `${exp}.${sig}` });
};

export const config = { path: "/api/auth" };
