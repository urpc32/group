// api/transfer.js - Vercel Serverless API Route for Roblox Group Ownership Transfer
// Deploy this as a Vercel project. Ensure you have a GitHub repo with this file in /api/transfer.js.
// Usage: POST to https://your-vercel-app.vercel.app/api/transfer
// Body: { groupId: number, newOwnerId: number, cookie: string }
// Requires ROBLOX_TRANSFER_API_KEY environment variable set in Vercel dashboard.

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request) {
  try {
    // Parse the incoming JSON body
    const body = await request.json();
    const { groupId, newOwnerId, cookie } = body;

    // Validate required fields
    if (!groupId || !newOwnerId || !cookie) {
      return NextResponse.json(
        { error: 'Missing required fields: groupId, newOwnerId, cookie' },
        { status: 400 }
      );
    }

    // Fetch the Roblox CSRF token using the provided cookie
    const cookieHeaders = {
      Cookie: cookie,
    };

    // First, get CSRF token from auth endpoint
    const csrfResponse = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      headers: {
        ...cookieHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!csrfResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch CSRF token. Check your cookie.' },
        { status: 401 }
      );
    }

    const csrfText = await csrfResponse.text();
    const xCsrfTokenMatch = csrfText.match(/"x-csrf-token":"([^"]+)"/);
    if (!xCsrfTokenMatch) {
      return NextResponse.json(
        { error: 'CSRF token not found in response.' },
        { status: 400 }
      );
    }
    const xCsrfToken = xCsrfTokenMatch[1];

    // Prepare headers for the transfer request
    const headers = {
      'Content-Type': 'application/json',
      'x-csrf-token': xCsrfToken,
      'RobloxTransferApiKey': process.env.ROBLOX_TRANSFER_API_KEY,
      ...cookieHeaders,
    };

    // Request body for ownership transfer
    const transferBody = {
      newOwnerTargetId: newOwnerId,
    };

    // Make the transfer request to Roblox Open Cloud API
    const transferResponse = await fetch(
      `https://apis.roblox.com/groups/v1/groups/${groupId}/transfer-ownership`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(transferBody),
      }
    );

    if (!transferResponse.ok) {
      const errorData = await transferResponse.text();
      return NextResponse.json(
        { error: 'Transfer failed', details: errorData },
        { status: transferResponse.status }
      );
    }

    const result = await transferResponse.json();

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
  } catch (error) {
    console.error('Transfer API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
