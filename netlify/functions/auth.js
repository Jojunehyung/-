// POST /api/auth  { password, otp } → { token }
// 보안(빡빡 모드):
//  - 비밀번호 + 구글 OTP(TOTP, TOTP_SECRET 설정 시 필수)
//  - IP당 5회 실패 → 15분 잠금
//  - 토큰 수명 TOKEN_HOURS (기본 12시간)
//  - (선택) TELEGRAM_BOT_TOKEN/CHAT_ID 설정 시 로그인·잠금 알림
//  - AUTH_SECRET 값을 바꾸면 발급된 모든 토큰이 즉시 무효화된다 (전기기 강제 로그아웃)
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const MAX_FAIL = 5;
const LOCK_MIN = 15;

function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const c of (s || "").toUpperCase().replace(/[\s=]+/g, "")) {
    const idx = A.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function totpOk(secret, input) {
  if (!/^\d{6}$/.test(input || "")) return false;
  const key = b32decode(secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const w of [-1, 0, 1]) { // 폰 시계 오차 ±30초 허용
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(step + w));
    const h = createHmac("sha1", key).update(buf).digest();
    const off = h[h.length - 1] & 0xf;
    const code = String((h.readUInt32BE(off) & 0x7fffffff) % 1e6).padStart(6, "0");
    try { if (timingSafeEqual(Buffer.from(code), Buffer.from(input))) return true; } catch { /* noop */ }
  }
  return false;
}

async function notify(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return;
  try {
    await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: c, text }),
    });
  } catch { /* 알림 실패는 로그인에 영향 주지 않음 */ }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const pw = process.env.ADMIN_PASSWORD || "";
  if (!pw) {
    return Response.json(
      { error: "서버에 ADMIN_PASSWORD 환경변수가 설정되지 않았습니다. Netlify 사이트 설정에서 추가하세요." },
      { status: 500 },
    );
  }

  const ip = req.headers.get("x-nf-client-connection-ip") || "unknown";
  const sec = getStore("security");
  const failKey = `fail:${ip}`;
  const rec = (await sec.get(failKey, { type: "json" })) || { count: 0, until: 0 };

  if (rec.until > Date.now()) {
    const min = Math.ceil((rec.until - Date.now()) / 60000);
    return Response.json({ error: `로그인이 잠겨 있습니다. ${min}분 후 다시 시도하세요.` }, { status: 423 });
  }

  let body = {};
  try { body = await req.json(); } catch { /* noop */ }

  const totpSecret = (process.env.TOTP_SECRET || "").trim();
  const pwOk = (body.password || "") === pw;
  const otpPass = totpSecret ? totpOk(totpSecret, (body.otp || "").trim()) : true;

  if (!pwOk || !otpPass) {
    rec.count += 1;
    // 어떤 요소가 틀렸는지는 알려주지 않는다 (공격자에게 힌트 차단)
    let msg = `인증 정보가 올바르지 않습니다. (남은 시도 ${Math.max(0, MAX_FAIL - rec.count)}회)`;
    if (rec.count >= MAX_FAIL) {
      rec.until = Date.now() + LOCK_MIN * 60000;
      rec.count = 0;
      msg = `${MAX_FAIL}회 실패로 ${LOCK_MIN}분간 잠깁니다.`;
      notify(`⚠ 그룹웨어 로그인 ${MAX_FAIL}회 실패 → ${LOCK_MIN}분 잠금 (IP: ${ip})`);
    }
    await sec.setJSON(failKey, rec);
    return Response.json({ error: msg }, { status: 401 });
  }

  await sec.delete(failKey);
  const hours = Number(process.env.TOKEN_HOURS || 12) || 12;
  const exp = Date.now() + hours * 3600 * 1000;
  const sig = createHmac("sha256", process.env.AUTH_SECRET || pw).update(String(exp)).digest("base64url");
  notify(`✅ 그룹웨어 로그인 성공 (IP: ${ip})`);
  return Response.json({ token: `${exp}.${sig}` });
};

export const config = { path: "/api/auth" };
