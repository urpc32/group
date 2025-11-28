// pages/api/get-csrf.js  (or app/api/get-csrf/route.js if using App Router)
// Gets a fresh, valid X-CSRF-TOKEN using only the .ROBLOSECURITY cookie
// 100% safe – does NOT log you out

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Manually parse raw body (required for large/unparsed payloads on Vercel)
  let rawBody = "";
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    rawBody = Buffer.concat(chunks).toString("utf-8");
  } catch (e) {
    return res.status(400).json({ error: "Failed to read request body" });
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  const { cookie: rawCookie } = body;
  const cookie = (rawCookie || "").toString().trim();

  if (!cookie || !cookie.includes("_|WARNING")) {
    return res.status(400).json({
      error: "Invalid or missing .ROBLOSECURITY cookie",
      tip: "Cookie must start with '_|WARNING:-'",
    });
  }

  try {
    // BEST & SAFEST ENDPOINT (2025): https://auth.roblox.com/
    // This endpoint is literally made for this purpose – returns token on 403, never logs out
    const response = await fetch("https://auth.roblox.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `.ROBLOSECURITY=${cookie}`,
        // Intentionally NO X-CSRF-TOKEN → forces Roblox to generate a fresh one
      },
      body: "{}", // Empty JSON body is sufficient
    });

    const newToken = response.headers.get("x-csrf-token") || response.headers.get("X-CSRF-Token");

    if (!newToken) {
      const text = await response.text();
      return res.status(400).json({
        success: false,
        error: "No X-CSRF-TOKEN returned from Roblox",
        tip: "Your cookie is likely expired, invalid, or rate-limited",
        status: response.status,
        responseBody: text.substring(0, 500),
      });
    }

    // Success!
    return res.status(200).json({
      success: true,
      csrfToken: newToken,
      message: "Fresh X-CSRF-TOKEN fetched successfully (safe method)",
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[get-csrf] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching CSRF token",
      details: err.message,
    });
  }
}

// Critical: Disable Vercel's default body parser
export const config = {
  api: {
    bodyParser: false,
  },
};
