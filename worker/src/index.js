// Contact form endpoint for VestaNabu LLC's sites: checks Turnstile, then sends the message through Postmark.
// Sites: www.vestanabullc.com, and Monaidea's sites (www.monaidea.com and any https://*.monaidea.com;
// Monaidea is VestaNabu LLC's public brand for its software products, added 2026-11-02).
// No database: Postmark and the inbox hold the record of every submission.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// www.vestanabullc.com: behaves exactly as before Monaidea was added.
const VESTANABU = {
  origins: ["https://www.vestanabullc.com", "https://vestanabullc.com"],
  contact: "info@vestanabullc.com",
  interests: ["Build together", "Consulting", "Partnership", "Something else"],
};

// Monaidea: messages go to support@monaidea.com. Each form sends its own topic (cleaned below),
// so a new form on a Monaidea site needs no change here; the Turnstile widget lists monaidea.com,
// which covers all its subdomains.
const MONAIDEA = {
  domain: "monaidea.com",
  to: "support@monaidea.com",
  contact: "support@monaidea.com",
  defaultTopic: "General question",
};

function siteFor(origin) {
  if (VESTANABU.origins.includes(origin)) return "vestanabu";
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname;
  const monaidea = host === MONAIDEA.domain || host.endsWith(`.${MONAIDEA.domain}`);
  if (url.protocol === "https:" && !url.port && url.origin === origin && monaidea) return "monaidea";
  return null;
}

function corsHeaders(origin) {
  const allowed = siteFor(origin) ? origin : VESTANABU.origins[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
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

// For subject lines: one line, no control characters.
function oneLine(value) {
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
}

async function verifyTurnstile(token, ip, secret) {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const result = await res.json();
    return result.success === true;
  } catch {
    return false;
  }
}

async function sendWithPostmark(env, message) {
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({ ...message, MessageStream: "outbound" }),
    });
    if (res.ok) return { ok: true };
    let code = "unknown";
    try {
      code = (await res.json()).ErrorCode ?? code;
    } catch {
      // Not JSON: keep "unknown".
    }
    return { ok: false, detail: `HTTP ${res.status}, Postmark error ${code}` };
  } catch {
    return { ok: false, detail: "Postmark unreachable" };
  }
}

function sendVestanabu(env, { name, email, interest, message }) {
  return sendWithPostmark(env, {
    From: `VestaNabu Website <${env.FROM_EMAIL}>`,
    To: env.TO_EMAIL,
    ReplyTo: email,
    Subject: `[${interest}] ${oneLine(name)}`,
    TextBody: `Name: ${name}\nEmail: ${email}\nInterest: ${interest}\n\n${message}`,
  });
}

async function sendMonaidea(env, { name, email, interest: topic, message }, origin) {
  const mail = {
    From: `Monaidea Website <${env.FROM_EMAIL}>`,
    To: MONAIDEA.to,
    ReplyTo: email,
    Subject: `[Monaidea · ${topic}] ${oneLine(name)}`,
    TextBody: `Site: ${origin}\nName: ${name}\nEmail: ${email}\nTopic: ${topic}\n\n${message}`,
  };
  const sent = await sendWithPostmark(env, mail);
  if (sent.ok) return sent;

  // Postmark refused support@monaidea.com (for example: while a Postmark account is pending approval it
  // only sends to the From address's domain). Deliver to TO_EMAIL instead, saying why, so the visitor's
  // message still arrives. The log line holds no visitor data.
  console.warn(`monaidea: Postmark refused ${MONAIDEA.to} (${sent.detail}); sent to TO_EMAIL instead`);
  return sendWithPostmark(env, {
    ...mail,
    To: env.TO_EMAIL,
    TextBody: `${mail.TextBody}\n\n--\nSent here because Postmark refused ${MONAIDEA.to} (${sent.detail}).`,
  });
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
    const site = siteFor(origin);
    if (!site) {
      return json({ ok: false, error: "Origin not allowed" }, 403, origin);
    }
    const contact = site === "monaidea" ? MONAIDEA.contact : VESTANABU.contact;

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid request" }, 400, origin);
    }
    if (!data || typeof data !== "object") {
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
    if (site === "vestanabu") {
      if (!VESTANABU.interests.includes(fields.interest)) fields.interest = "Something else";
    } else {
      fields.interest = oneLine(fields.interest) || MONAIDEA.defaultTopic;
    }

    const human = await verifyTurnstile(
      clean(data.turnstileToken, 2048),
      request.headers.get("CF-Connecting-IP"),
      env.TURNSTILE_SECRET,
    );
    if (!human) {
      return json({ ok: false, error: "Verification failed. Please try again." }, 403, origin);
    }

    const sent = site === "monaidea" ? await sendMonaidea(env, fields, origin) : await sendVestanabu(env, fields);
    if (!sent.ok) {
      return json({ ok: false, error: `Message could not be sent. Please email ${contact}.` }, 502, origin);
    }

    return json({ ok: true }, 200, origin);
  },
};
