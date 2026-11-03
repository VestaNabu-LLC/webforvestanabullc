// Contact form endpoint: checks Turnstile, then sends the message through Postmark.
// No database: Postmark and the inbox hold the record of every submission.

const ALLOWED_ORIGINS = ["https://www.vestanabullc.com", "https://vestanabullc.com"];
const INTERESTS = ["Build together", "Consulting", "Partnership", "Something else"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

async function verifyTurnstile(token, ip, secret) {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const result = await res.json();
  return result.success === true;
}

async function sendWithPostmark(env, { name, email, interest, message }) {
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      From: `VestaNabu Website <${env.FROM_EMAIL}>`,
      To: env.TO_EMAIL,
      ReplyTo: email,
      Subject: `[${interest}] ${name}`,
      TextBody: `Name: ${name}\nEmail: ${email}\nInterest: ${interest}\n\n${message}`,
      MessageStream: "outbound",
    }),
  });
  return res.ok;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, origin);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: "Origin not allowed" }, 403, origin);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid request" }, 400, origin);
    }

    // Honeypot: real visitors never fill this field. Pretend success so bots move on.
    if (clean(data.website, 100)) {
      return json({ ok: true }, 200, origin);
    }

    const fields = {
      name: clean(data.name, 120),
      email: clean(data.email, 200),
      interest: clean(data.interest, 60),
      message: clean(data.message, 4000),
    };

    if (!fields.name || !EMAIL_PATTERN.test(fields.email) || !fields.message) {
      return json({ ok: false, error: "Please fill in your name, a valid email and a message." }, 400, origin);
    }
    if (!INTERESTS.includes(fields.interest)) {
      fields.interest = "Something else";
    }

    const human = await verifyTurnstile(
      clean(data.turnstileToken, 2048),
      request.headers.get("CF-Connecting-IP"),
      env.TURNSTILE_SECRET,
    );
    if (!human) {
      return json({ ok: false, error: "Verification failed. Please try again." }, 403, origin);
    }

    const sent = await sendWithPostmark(env, fields);
    if (!sent) {
      return json({ ok: false, error: "Message could not be sent. Please email info@vestanabullc.com." }, 502, origin);
    }

    return json({ ok: true }, 200, origin);
  },
};
