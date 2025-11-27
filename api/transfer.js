// api/get-csrf.js
// Gets a fresh, valid X-CSRF-TOKEN using only the .ROBLOSECURITY cookie
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Manual raw body (same trick as your change-owner route)
  let rawBody = "";
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    rawBody = Buffer.concat(chunks).toString("utf-8");
    if (!rawBody.trim()) throw new Error("Empty body");
  } catch (e) {
    return res.status(400).json({ error: "No body sent" });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { cookie: rawCookie = "" } = body;
  const cookie = (rawCookie || "").toString().trim().replace(/^["']|["']$/g, "");

  if (!cookie) {
    return res.status(400).json({ error: "Missing .ROBLOSECURITY cookie" });
  }

  try {
    // Step 1: Do a dummy POST request that always requires CSRF (e.g. logout)
    // Roblox will respond with 403 and set the x-csrf-token header
    const dummy = await fetch("https://auth.roblox.com/v2/logout", {
      method: "POST",
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        // No X-CSRF-TOKEN header on purpose → forces Roblox to give us a new one
      },
      body: "{}", // empty JSON is fine
    });

    const newToken = dummy.headers.get("x-csrf-token");

    if (!newToken) {
      return res.status(400).json({
        error: "Failed to retrieve X-CSRF-TOKEN",
        tip: "Cookie might be invalid, expired, or IP-banned",
        robloxStatus: dummy.status,
        robloxBody: await dummy.text().catch(() => "unreadable"),
      });
    }

    // Success – return the fresh token
    return res.status(200).json({
      success: true,
      csrfToken: newToken,
      message: "Fresh X-CSRF-TOKEN obtained – ready to change owner",
    });
  } catch (err) {
    console.error("CSRF fetch error:", err);
    return res.status(500).json({
      error: "Unexpected error while fetching CSRF token",
      details: err.message,
    });
  }
}

// Critical: disable Vercel's automatic body parser
export const config = {
  api: {
    bodyParser: false,
  },
};
