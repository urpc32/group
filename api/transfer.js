// api/change-owner.js
// Vercel serverless function – expects X-CSRF-TOKEN to be sent by the client

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { cookie, csrfToken, groupId, targetId } = req.body;

    // Validate all required fields
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

    // Perform the ownership change
    const response = await fetch(
      `https://groups.roblox.com/v1/groups/${parsedGroupId}/change-owner`,
      {
        method: "POST",
        headers: {
          Cookie: `.ROBLOSECURITY=${cookie}`,
          "X-CSRF-TOKEN": csrfToken,
          "Content-Type": "application/json",
          Accept: "application/json",
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
      message: err.message,
    });
  }
}

// Allow large cookies / bodies if needed
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};
