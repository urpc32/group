// pages/api/change-group-owner.js
// Gets CSRF token from groups domain and changes group owner
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

  const { cookie: rawCookie, groupId, userId } = body;

  // Validate required fields
  if (!groupId) {
    return res.status(400).json({
      success: false,
      error: "Missing required field: groupId",
      tip: "Provide the numeric ID of the group you want to transfer ownership of",
    });
  }

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: "Missing required field: userId",
      tip: "Provide the numeric user ID of the new owner",
    });
  }

  // Validate that groupId and userId are valid numbers
  const groupIdNum = parseInt(groupId, 10);
  const userIdNum = parseInt(userId, 10);

  if (isNaN(groupIdNum) || groupIdNum <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid groupId",
      tip: "groupId must be a positive number",
    });
  }

  if (isNaN(userIdNum) || userIdNum <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid userId",
      tip: "userId must be a positive number",
    });
  }

  // Handle cookie validation - support both formats
  let cookie = (rawCookie || "").toString().trim();
  
  // Handle cookies in format "CAEaAhADIhwKBG..." (with or without .ROBLOSECURITY= prefix)
  if (cookie.startsWith(".ROBLOSECURITY=")) {
    cookie = cookie.substring(".ROBLOSECURITY=".length);
  }

  if (!cookie || cookie.length < 10 || !cookie.startsWith("CA")) {
    return res.status(400).json({
      success: false,
      error: "Invalid or missing .ROBLOSECURITY cookie",
      tip: "Cookie should start with 'CA' (like CAEaAhADIhwKBG...)",
    });
  }

  // STEP 1: Get fresh CSRF token FROM GROUPS DOMAIN
  let csrfToken;
  try {
    console.log("[change-group-owner] Fetching CSRF token from groups.roblox.com...");
    
    // CRITICAL FIX: Use groups.roblox.com endpoint to get domain-specific CSRF
    // This endpoint is safe and returns a valid token for groups operations
    const csrfResponse = await fetch(
      `https://groups.roblox.com/v1/groups/${groupIdNum}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `.ROBLOSECURITY=${cookie}`,
          // Intentionally NO X-CSRF-TOKEN → forces Roblox to generate a fresh one
        },
        body: JSON.stringify({}),
      }
    );

    csrfToken = 
      csrfResponse.headers.get("x-csrf-token") || 
      csrfResponse.headers.get("X-CSRF-Token") ||
      csrfResponse.headers.get("X-CSRF-TOKEN");

    if (!csrfToken) {
      let text = "";
      try {
        text = await csrfResponse.text();
      } catch (e) {
        text = "Could not read response body";
      }
      
      console.error("[change-group-owner] No CSRF token received. Status:", csrfResponse.status);
      
      return res.status(400).json({
        success: false,
        error: "No X-CSRF-TOKEN returned from Roblox groups API",
        tip: "Your cookie is likely expired, invalid, or rate-limited",
        status: csrfResponse.status,
        responseBody: text.substring(0, 500),
      });
    }

    console.log("[change-group-owner] CSRF token obtained successfully from groups domain");
    
  } catch (err) {
    console.error("[change-group-owner] CSRF fetch error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching CSRF token",
      details: err.message,
    });
  }

  // STEP 2: Change group owner using the fresh CSRF token
  try {
    console.log(`[change-group-owner] Transferring group ${groupIdNum} to user ${userIdNum}...`);
    
    const response = await fetch(
      `https://groups.roblox.com/v1/groups/${groupIdNum}/change-owner`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrfToken,
          Cookie: `.ROBLOSECURITY=${cookie}`,
        },
        body: JSON.stringify({
          userId: userIdNum,
        }),
      }
    );

    let responseText = "";
    let responseData = {};
    
    try {
      responseText = await response.text();
      if (responseText) {
        responseData = JSON.parse(responseText);
      }
    } catch (e) {
      console.error("[change-group-owner] Response parse error:", e);
      responseData = { rawResponse: responseText.substring(0, 500) };
    }

    console.log(`[change-group-owner] Response status: ${response.status}`);

    // Handle successful response (200)
    if (response.status === 200) {
      console.log("[change-group-owner] Transfer successful!");
      return res.status(200).json({
        success: true,
        message: "Group ownership transferred successfully",
        groupId: groupIdNum,
        newOwnerId: userIdNum,
        responseData,
        transferredAt: new Date().toISOString(),
      });
    }

    // Handle common error responses
    const errorMessages = {
      400: "Bad request - Invalid groupId or userId format",
      401: "Unauthorized - Cookie is invalid or expired",
      403: "Forbidden - You may not have permission to transfer this group, or user is not in the group",
      404: "Not found - Group or user does not exist",
      429: "Rate limited - Too many requests, try again later",
      500: "Roblox server error - Try again later",
      503: "Roblox service unavailable - Try again later",
    };

    console.error(`[change-group-owner] Transfer failed with status ${response.status}:`, responseData);

    return res.status(response.status >= 500 ? 502 : response.status).json({
      success: false,
      error: errorMessages[response.status] || `Request failed with status ${response.status}`,
      status: response.status,
      responseData,
      tip: "Check that you are the current group owner and the target user is in the group",
    });

  } catch (err) {
    console.error("[change-group-owner] Transfer request error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error while changing group owner",
      details: err.message,
      tip: "Check your network connection and try again",
    });
  }
}

// Critical: Disable Vercel's default body parser
export const config = {
  api: {
    bodyParser: false,
  },
};
