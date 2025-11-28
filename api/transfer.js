// pages/api/change-group-owner.js (or app/api/change-group-owner/route.js if using App Router)
// Gets CSRF token and changes group owner in one call
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

  const { cookie: rawCookie, groupId, userId } = body;

  // Validate required fields
  if (!groupId) {
    return res.status(400).json({
      error: "Missing required field: groupId",
      tip: "Provide the numeric ID of the group you want to transfer ownership of",
    });
  }

  if (!userId) {
    return res.status(400).json({
      error: "Missing required field: userId",
      tip: "Provide the numeric user ID of the new owner",
    });
  }

  // Handle cookie validation
  let cookie = (rawCookie || "").toString().trim();
  if (cookie.startsWith(".ROBLOSECURITY=")) {
    cookie = cookie.substring(".ROBLOSECURITY=".length);
  }

  if (!cookie || cookie.length < 10 || !cookie.startsWith("CA")) {
    return res.status(400).json({
      error: "Invalid or missing .ROBLOSECURITY cookie",
      tip: "Cookie should start with 'CA' (like CAEaAhADIhwKBG...)",
    });
  }

  // STEP 1: Get fresh CSRF token
  let csrfToken;
  try {
    const csrfResponse = await fetch("https://auth.roblox.com/v2/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `.ROBLOSECURITY=${cookie}`,
      },
      body: JSON.stringify({
        ctype: "Username",
        cvalue: "",
        password: ""
      }),
    });

    csrfToken = 
      csrfResponse.headers.get("x-csrf-token") || 
      csrfResponse.headers.get("X-CSRF-Token") ||
      csrfResponse.headers.get("X-CSRF-TOKEN");

    if (!csrfToken) {
      const text = await csrfResponse.text();
      return res.status(400).json({
        success: false,
        error: "Failed to get CSRF token from Roblox",
        tip: "Your cookie is likely expired, invalid, or rate-limited",
        status: csrfResponse.status,
        responseBody: text.substring(0, 500),
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Error fetching CSRF token",
      details: err.message,
    });
  }
