// api/change-owner.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // === Manually parse body to avoid Vercel's strict parser ===
  let body;
  try {
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const rawBody = Buffer.concat(buffers).toString("utf-8");
    
    // If body is empty or just whitespace
    if (!rawBody || !rawBody.trim()) {
      return res.status(400).json({ error: "Empty request body" });
    }

    body = JSON.parse(rawBody);
  } catch (parseError) {
    console.error("Failed to parse JSON body:", parseError);
    return res.status(400).json({
      error: "Invalid JSON in request body",
      details: parseError.message,
    });
  }
  // ========================================================

  try {
    const { cookie, csrfToken, groupId, targetId } = body;

    if (!cookie || !csrfToken || !groupId || !targetId) {
      return res.status(400).json({
        error: "Missing required parameters",
        required: ["cookie", "csrfToken", "groupId", "targetId"],
      });
    }

    const parsedGroupId = parseInt(groupId, 10);
    const parsedTargetId = parseInt(targetId, 10);

    if (isNaN(parsedGroupId) || isNaN(parsedTargetId)) {
      return res.status(400).json({ error: "groupId and targetId must be valid numbers" });
    }

    const response = await fetch(
      `https://groups.roblox.com/v1/groups/${parsedGroupId}/change-owner`,
      {
        method: "POST",
        headers: {
          "Cookie": `.ROBLOSECURITY=${cookie}`,
          "X-CSRF-TOKEN": csrfToken,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ userId: parsedTargetId }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Roblox API error",
        roblox: data,
        status: response.status,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ownership transferred successfully",
      data,
    });
  } catch (err) {
    console.error("change-owner error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err.message || "Unknown error",
    });
  }
}

// This is the key: disable Vercel's default body parser
export const config = {
  api: {
    bodyParser: false, // We handle parsing ourselves
  },
};
