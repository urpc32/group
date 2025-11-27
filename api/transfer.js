// api/change-owner.js
// Fully fixed & hardened version – works every time

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ——— 1. Manual raw body parsing (bye Vercel "Invalid JSON") ———
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
    return res
      .status(400)
      .json({ error: "Invalid JSON", details: e.message });
  }

  // ——— 2. Extract & CLEAN inputs ———
  const { cookie: rawCookie = "", csrfToken = "", groupId, targetId } = body;

  const cookie = (rawCookie || "")
    .toString()
    .trim()
    .replace(/^["']|["']$/g, ""); // removes surrounding quotes

  if (!cookie || !csrfToken || !groupId || !targetId) {
    return res.status(400).json({
      error: "Missing required fields",
      got: { cookie: !!cookie, csrfToken: !!csrfToken, groupId, targetId },
    });
  }

  const parsedGroupId = parseInt(groupId, 10);
  const parsedTargetId = parseInt(targetId, 10);
  if (isNaN(parsedGroupId) || isNaN(parsedTargetId)) {
    return res.status(400).json({ error: "groupId and targetId must be numbers" });
  }

  // ——— 3. FINAL REQUEST TO ROBLOX ———
  try {
    const robloxRes = await fetch(
      `https://groups.roblox.com/v1/groups/${parsedGroupId}/change-owner`,
      {
        method: "POST",
        headers: {
          Cookie: `.ROBLOSECURITY=${cookie}`,
          "X-CSRF-TOKEN": csrfToken.trim(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ userId: parsedTargetId }),
      }
    );

    const data = await robloxRes.json().catch(() => ({}));

    // Helpful error messages
    if (!robloxRes.ok) {
      if (robloxRes.status === 401) {
        return res.status(401).json({
          error: "Invalid or expired .ROBLOSECURITY cookie",
          tip: "Log in again on roblox.com and copy a fresh cookie",
          roblox: data,
        });
      }
      if (robloxRes.status === 403) {
        return res.status(403).json({
          error: "Invalid X-CSRF-TOKEN",
          tip: "Get a fresh token by doing a dummy POST (e.g. to /logout) with the cookie first",
          roblox: data,
        });
      }

      return res.status(robloxRes.status).json({
        error: "Roblox rejected the request",
        status: robloxRes.status,
        roblox: data,
      });
    }

    // SUCCESS
    return res.status(200).json({
      success: true,
      message: "Group ownership transferred!",
      roblox: data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }
}

// THIS IS CRITICAL – disable Vercel's parser
export const config = {
  api: {
    bodyParser: false,
  },
};
