// api/change-owner.js
// Vercel serverless function for Roblox group ownership transfer

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ownerId, targetId, cookie, groupId } = req.body;

    // Validate required parameters
    if (!ownerId || !targetId || !cookie || !groupId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['ownerId', 'targetId', 'cookie', 'groupId']
      });
    }

    // Step 1: Get CSRF token
    const csrfResponse = await fetch('https://auth.roblox.com/v1/authentication-ticket', {
      method: 'POST',
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'Content-Type': 'application/json'
      }
    });

    const csrfToken = csrfResponse.headers.get('x-csrf-token');
    
    if (!csrfToken) {
      return res.status(401).json({
        error: 'Failed to obtain CSRF token',
        details: 'Invalid .ROBLOSECURITY cookie or authentication failed'
      });
    }

    // Step 2: Make the ownership transfer request
    const transferResponse = await fetch(
      `https://groups.roblox.com/v1/groups/${groupId}/change-owner`,
      {
        method: 'POST',
        headers: {
          'Cookie': `.ROBLOSECURITY=${cookie}`,
          'X-CSRF-TOKEN': csrfToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          userId: parseInt(targetId)
        })
      }
    );

    const responseData = await transferResponse.json();

    // Check if the request was successful
    if (!transferResponse.ok) {
      return res.status(transferResponse.status).json({
        error: 'Ownership transfer failed',
        details: responseData,
        status: transferResponse.status
      });
    }

    // Success response
    return res.status(200).json({
      success: true,
      message: 'Group ownership transferred successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

// CORS configuration (optional, uncomment if needed)
export const config = {
  api: {
    bodyParser: true,
  },
};
