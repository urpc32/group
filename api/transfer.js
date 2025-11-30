// pages/api/change-group-owner.js
// Comprehensive group ownership transfer with validation and fallback methods
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse request body
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

  const { cookie: rawCookie, groupId, userId: newOwnerId, playerId } = body;

  // Validate required fields
  if (!groupId || !newOwnerId || !rawCookie) {
    const missing = [];
    if (!groupId) missing.push("groupId");
    if (!newOwnerId) missing.push("userId");
    if (!rawCookie) missing.push("cookie");
    
    return res.status(400).json({
      success: false,
      error: `Missing required parameters: ${missing.join(", ")}`
    });
  }

  // Validate and parse numeric values
  const numericGroupId = parseInt(groupId, 10);
  const numericNewOwnerId = parseInt(newOwnerId, 10);
  const numericPlayerId = playerId ? parseInt(playerId, 10) : null;

  if (isNaN(numericGroupId) || numericGroupId <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid groupId: must be a positive number"
    });
  }

  if (isNaN(numericNewOwnerId) || numericNewOwnerId <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid newOwnerId: must be a positive number"
    });
  }

  // Clean and validate cookie
  let cookieToken = rawCookie.toString().trim();
  if (cookieToken.startsWith(".ROBLOSECURITY=")) {
    cookieToken = cookieToken.substring(".ROBLOSECURITY=".length);
  }

  if (!cookieToken || cookieToken.length < 10) {
    return res.status(400).json({
      success: false,
      error: "Invalid cookie: empty after cleaning"
    });
  }

  console.log("🔄 Starting ownership transfer process...");
  console.log("📋 Group ID:", numericGroupId);
  console.log("📋 New Owner ID:", numericNewOwnerId);
  if (numericPlayerId) console.log("📋 Player ID:", numericPlayerId);

  try {
    // STEP 1: Check account eligibility
    console.log("🔍 Step 1: Checking account eligibility...");
    const eligibilityResult = await checkAccountEligibility(cookieToken);
    
    if (!eligibilityResult.success) {
      console.log("❌ Eligibility check failed:", eligibilityResult.error);
      return res.status(400).json({
        success: false,
        error: `Eligibility check failed: ${eligibilityResult.error}`
      });
    }

    console.log("✅ Account Info:");
    console.log("  - Username:", eligibilityResult.username);
    console.log("  - User ID:", eligibilityResult.userId);
    console.log("  - Account Age:", eligibilityResult.accountAge >= 0 ? `${eligibilityResult.accountAge} days` : "Unknown");
    console.log("  - Verified Email:", eligibilityResult.hasVerifiedEmail ? "Yes" : "No");
    console.log("  - Premium:", eligibilityResult.isPremium ? "Yes" : "No");

    // Warnings
    const warnings = [];
    if (eligibilityResult.accountAge >= 0 && eligibilityResult.accountAge < 30) {
      warnings.push("Account is less than 30 days old - may face additional restrictions");
      console.log("⚠️  WARNING:", warnings[warnings.length - 1]);
    }
    if (!eligibilityResult.hasVerifiedEmail) {
      warnings.push("Email not verified - may cause transfer restrictions");
      console.log("⚠️  WARNING:", warnings[warnings.length - 1]);
    }

    // STEP 2: Verify authentication (if playerId provided)
    if (numericPlayerId) {
      console.log("🔍 Step 2: Verifying authentication...");
      if (eligibilityResult.userId !== numericPlayerId) {
        console.log("❌ User ID mismatch - Cookie doesn't belong to player");
        console.log("Expected:", numericPlayerId, "Got:", eligibilityResult.userId);
        return res.status(403).json({
          success: false,
          error: `User ID mismatch: expected ${numericPlayerId}, got ${eligibilityResult.userId}`
        });
      }
      console.log("✅ Authentication successful for:", eligibilityResult.username);
    }

    // STEP 3: Get group information and verify ownership
    console.log("🔍 Step 3: Checking group ownership...");
    const groupResult = await getGroupInfo(numericGroupId, cookieToken);
    
    if (!groupResult.success) {
      console.log("❌ Failed to get group info:", groupResult.error);
      return res.status(400).json({
        success: false,
        error: `Failed to get group info: ${groupResult.error}`
      });
    }

    const groupData = groupResult.data;
    if (!groupData || !groupData.owner || !groupData.owner.userId) {
      console.log("❌ Group has no owner or is invalid");
      return res.status(400).json({
        success: false,
        error: "Group has no owner or group data is invalid"
      });
    }

    const currentOwnerId = parseInt(groupData.owner.userId, 10);
    if (isNaN(currentOwnerId)) {
      console.log("❌ Invalid owner ID in group data");
      return res.status(400).json({
        success: false,
        error: "Invalid owner ID in group data"
      });
    }

    if (currentOwnerId !== eligibilityResult.userId) {
      console.log("❌ Player is not the group owner");
      console.log(" Current owner ID:", currentOwnerId);
      console.log(" Player ID:", eligibilityResult.userId);
      return res.status(403).json({
        success: false,
        error: `Player ${eligibilityResult.userId} is not the owner of group ${numericGroupId} (current owner: ${currentOwnerId})`,
        currentOwner: currentOwnerId
      });
    }
    console.log("✅ Ownership verified - Player owns the group");

    // STEP 4: Get CSRF token
    console.log("🔐 Step 4: Getting CSRF token...");
    const csrfResult = await getCSRFToken(cookieToken);
    
    if (!csrfResult.success) {
      console.log("❌ CSRF token failed:", csrfResult.error);
      return res.status(400).json({
        success: false,
        error: `Failed to get CSRF token: ${csrfResult.error}`
      });
    }
    console.log("✅ CSRF token obtained");

    // STEP 5: Transfer ownership with fallback
    console.log("🔄 Step 5: Transferring ownership...");
    let transferResult = await transferGroupOwnership(
      numericGroupId, 
      numericNewOwnerId, 
      cookieToken, 
      csrfResult.token
    );

    // If primary method fails with challenge required, try alternative
    if (!transferResult.success && transferResult.statusCode === 403 && 
        transferResult.error.includes("Challenge")) {
      console.log("🔄 Primary method failed, trying alternative approach...");
      transferResult = await transferGroupOwnershipAlternative(
        numericGroupId,
        numericNewOwnerId,
        cookieToken,
        csrfResult.token
      );
    }

    if (transferResult.success) {
      console.log("🎉 Ownership transfer completed successfully!");
      return res.status(200).json({
        success: true,
        message: "Ownership transferred successfully",
        previousOwner: eligibilityResult.userId,
        newOwner: numericNewOwnerId,
        groupId: numericGroupId,
        groupName: groupData.name || "Unknown",
        transferredAt: new Date().toISOString(),
        warnings: warnings.length > 0 ? warnings : undefined
      });
    } else {
      console.log("❌ All transfer methods failed:", transferResult.error);

      // Provide specific guidance based on the error
      let guidance = "";
      if (transferResult.error.includes("Challenge")) {
        guidance = "\n\n📝 SOLUTIONS TO TRY:\n" +
          "1. Wait 30+ days after account creation\n" +
          "2. Verify email address in Roblox settings\n" +
          "3. Add Robux to the account (even 5-10 Robux helps)\n" +
          "4. Use the account actively for a few days\n" +
          "5. Try the transfer through Roblox website first\n" +
          "6. Contact Roblox Support if account is flagged";
      }

      return res.status(transferResult.statusCode >= 500 ? 502 : transferResult.statusCode || 400).json({
        success: false,
        error: `Transfer failed: ${transferResult.error}${guidance}`,
        statusCode: transferResult.statusCode
      });
    }

  } catch (error) {
    console.error("❌ Unexpected error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message
    });
  }
}

// Helper: Get CSRF token with multiple fallback endpoints
async function getCSRFToken(cookieToken) {
  // Try the login endpoint first (most reliable, doesn't log out)
  try {
    const response = await fetch("https://auth.roblox.com/v2/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `.ROBLOSECURITY=${cookieToken}`
      },
      body: JSON.stringify({
        ctype: "Username",
        cvalue: "",
        password: ""
      })
    });

    let csrfToken = response.headers.get("x-csrf-token") || 
                    response.headers.get("X-CSRF-Token") ||
                    response.headers.get("X-CSRF-TOKEN");

    if (csrfToken) {
      return { success: true, token: csrfToken };
    }
  } catch (err) {
    console.error("Primary CSRF endpoint failed:", err.message);
  }

  // Fallback endpoints
  const endpoints = [
    "https://auth.roblox.com/v2/logout",
    "https://friends.roblox.com/v1/users/1/request-friendship",
    "https://groups.roblox.com/v1/groups/1/join-requests"
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `.ROBLOSECURITY=${cookieToken}`
        },
        body: "{}"
      });

      let csrfToken = response.headers.get("x-csrf-token") || 
                      response.headers.get("X-CSRF-Token") ||
                      response.headers.get("X-CSRF-TOKEN");

      if (csrfToken) {
        return { success: true, token: csrfToken };
      }

      // Small delay between attempts
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.error(`CSRF endpoint ${endpoint} failed:`, err.message);
    }
  }

  return { 
    success: false, 
    error: "Failed to obtain CSRF token from any endpoint" 
  };
}

// Helper: Get authenticated user info
async function getAuthenticatedUser(cookieToken) {
  try {
    const response = await fetch("https://users.roblox.com/v1/users/authenticated", {
      method: "GET",
      headers: {
        "Cookie": `.ROBLOSECURITY=${cookieToken}`,
        "Content-Type": "application/json"
      }
    });

    if (response.ok) {
      const userData = await response.json();
      if (userData && userData.id && userData.name) {
        return {
          success: true,
          userId: parseInt(userData.id, 10),
          username: userData.name
        };
      }
    }

    const errorText = await response.text();
    return {
      success: false,
      error: `HTTP ${response.status}: ${errorText || "Unknown error"}`
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

// Helper: Check account eligibility
async function checkAccountEligibility(cookieToken) {
  const authResult = await getAuthenticatedUser(cookieToken);
  if (!authResult.success) {
    return { success: false, error: authResult.error };
  }

  try {
    const response = await fetch(`https://users.roblox.com/v1/users/${authResult.userId}`, {
      method: "GET",
      headers: {
        "Cookie": `.ROBLOSECURITY=${cookieToken}`,
        "Content-Type": "application/json"
      }
    });

    if (response.ok) {
      const userData = await response.json();
      const created = userData.created;
      let accountAge = -1;

      if (created) {
        const createdDate = new Date(created);
        const currentDate = new Date();
        accountAge = Math.floor((currentDate - createdDate) / (24 * 3600 * 1000));
      }

      return {
        success: true,
        userId: authResult.userId,
        username: authResult.username,
        accountAge: accountAge,
        hasVerifiedEmail: userData.hasVerifiedEmail || false,
        isPremium: userData.isPremium || false
      };
    }
  } catch (err) {
    // If we can't get detailed info, return basic auth info
  }

  return {
    success: true,
    userId: authResult.userId,
    username: authResult.username,
    accountAge: -1,
    hasVerifiedEmail: false,
    isPremium: false
  };
}

// Helper: Get group information
async function getGroupInfo(groupId, cookieToken) {
  try {
    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`, {
      method: "GET",
      headers: {
        "Cookie": `.ROBLOSECURITY=${cookieToken}`,
        "Content-Type": "application/json"
      }
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, data: data };
    }

    const errorText = await response.text();
    return {
      success: false,
      error: `HTTP ${response.status}: ${errorText || "Unknown error"}`
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

// Helper: Transfer group ownership (primary method)
async function transferGroupOwnership(groupId, newOwnerId, cookieToken, csrfToken) {
  try {
    const response = await fetch(
      `https://groups.roblox.com/v1/groups/${groupId}/change-owner`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrfToken,
          "Cookie": `.ROBLOSECURITY=${cookieToken}`
        },
        body: JSON.stringify({ userId: newOwnerId })
      }
    );

    console.log("📡 Transfer request completed");
    console.log("📊 Status Code:", response.status);

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: true, data: data };
    }

    // Enhanced error handling
    const statusCode = response.status;
    let errorMessage = "Unknown error";

    try {
      const errorData = await response.json();
      if (errorData.errors && errorData.errors[0] && errorData.errors[0].message) {
        errorMessage = errorData.errors[0].message;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch (e) {
      const errorText = await response.text().catch(() => "");
      if (errorText) errorMessage = errorText;
    }

    // Common HTTP status code meanings
    if (statusCode === 401) {
      errorMessage = "Unauthorized - Invalid authentication cookie";
    } else if (statusCode === 403) {
      if (errorMessage.includes("Challenge")) {
        errorMessage = "Challenge Required - This account needs 2FA verification or email confirmation to transfer group ownership. This cannot be bypassed programmatically.";
      } else if (errorMessage.includes("CSRF")) {
        errorMessage = "CSRF Token Invalid - Authentication token verification failed";
      } else if (!errorMessage || errorMessage === "Unknown error") {
        errorMessage = "Forbidden - Insufficient permissions";
      }
    } else if (statusCode === 404) {
      errorMessage = "Not Found - Group does not exist or user cannot access it";
    } else if (statusCode === 429) {
      errorMessage = "Rate Limited - Too many requests, please wait before trying again";
    }

    console.log("📄 Error:", errorMessage);

    return {
      success: false,
      error: `HTTP ${statusCode}: ${errorMessage}`,
      statusCode: statusCode
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      statusCode: 0
    };
  }
}

// Helper: Alternative transfer method using v2 endpoint
async function transferGroupOwnershipAlternative(groupId, newOwnerId, cookieToken, csrfToken) {
  console.log("🔄 Trying alternative transfer method...");

  try {
    const response = await fetch(
      `https://groups.roblox.com/v2/groups/${groupId}/membership/users/${newOwnerId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrfToken,
          "Cookie": `.ROBLOSECURITY=${cookieToken}`
        },
        body: JSON.stringify({ 
          role: "Owner",
          transferOwnership: true 
        })
      }
    );

    if (response.ok || response.status === 204) {
      return { success: true, data: {} };
    }

    return { 
      success: false, 
      error: "Alternative method failed", 
      statusCode: response.status 
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      statusCode: 0
    };
  }
}

// Disable Vercel's default body parser
export const config = {
  api: {
    bodyParser: false,
  },
};
