// pages/api/change-group-owner.js
// Changes group owner using safe CSRF token fetching (does NOT log you out)
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

  // Handle cookie - keep the full cookie string with prefix for CSRF request
  let fullCookie = (rawCookie || "").toString().trim();
  
  // Ensure it has the .ROBLOSECURITY= prefix for the CSRF request
  if (!fullCookie.startsWith(".ROBLOSECURITY=")) {
    fullCookie = `.ROBLOSECURITY=${fullCookie}`;
  }

  // Extract just the token part (without prefix) for validation and change-owner request
  let cookieToken = fullCookie.substring(".ROBLOSECURITY=".length);

  if (!cookieToken || cookieToken.length < 10 || !cookieToken.startsWith("CA")) {
    return res.status(400).json({
      success: false,
      error: "Invalid or missing .ROBLOSECURITY cookie",
      tip: "Cookie should start with 'CA' (like CAEaAhADIhwKBG...)",
    });
  }

  // STEP 1: Get CSRF token using the safe login endpoint (does NOT log you out)
  let csrfToken;
  try {
    console.log("[change-group-owner] Getting CSRF token from Roblox login endpoint...");
    
    // BEST & SAFEST ENDPOINT: https://auth.roblox.com/v2/login
    // This returns a fresh CSRF token on 403, never logs out
    const csrfResponse = await fetch("https://auth.roblox.com/v2/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `.ROBLOSECURITY=${cookie}`,
        // Intentionally NO x-csrf-token → forces Roblox to generate a fresh one
      },
      body: JSON.stringify({
        ctype: "Username",
        cvalue: "",
        password: ""
      }),
    });

    // Try all possible header name variations (Roblox can be inconsistent)
    csrfToken = 
      csrfResponse.headers.get("x-csrf-token") || 
      csrfResponse.headers.get("X-CSRF-Token") ||
      csrfResponse.headers.get("X-CSRF-TOKEN");

    if (!csrfToken) {
      console.error("[change-group-owner] No CSRF token in response headers");
      
      // Try to get more info about the error
      let errorText = "";
      try {
        errorText = await csrfResponse.text();
      } catch (e) {
        errorText = "Unable to read error response";
      }

      return res.status(400).json({
        success: false,
        error: "Failed to obtain CSRF token from Roblox",
        tip: "Your cookie may be expired, invalid, or rate-limited",
        status: csrfResponse.status,
        details: errorText.substring(0, 200),
      });
    }

    console.log("[change-group-owner] CSRF token obtained successfully");
    
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
          "x-csrf-token": csrfToken, // lowercase header name
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
