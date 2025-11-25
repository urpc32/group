// api/transfer.js  ← Single file, Vercel-ready. POST { groupId, newOwnerId, cookie: ".ROBLOSECURITY=..." }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { groupId, newOwnerId, cookie } = req.body;
  if (!groupId || !newOwnerId || !cookie) return res.status(400).json({ error: 'Need groupId, newOwnerId, cookie' });
  
  try {
    // Clean cookie: remove .ROBLOSECURITY= prefix if present
    const cleanCookie = cookie.startsWith('.ROBLOSECURITY=') 
      ? cookie.substring(15) 
      : cookie;
    const fullCookie = `.ROBLOSECURITY=${cleanCookie}`;
    
    console.log('🔍 Cookie length:', cleanCookie.length);
    console.log('🔍 Cookie preview:', cleanCookie.substring(0, 50) + '...');
    
    // Step 1: Fetch CSRF token using the cookie (logout trick—doesn't actually log out)
    const csrfRes = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      headers: {
        'Cookie': fullCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    
    console.log('🔍 CSRF Response Status:', csrfRes.status);
    console.log('🔍 CSRF Response Headers:', Object.fromEntries(csrfRes.headers.entries()));
    
    if (!csrfRes.ok) {
      const errorBody = await csrfRes.text();
      console.log('❌ CSRF Error Body:', errorBody);
      return res.status(401).json({ 
        error: 'Invalid cookie—CSRF fetch failed',
        status: csrfRes.status,
        details: errorBody
      });
    }
    
    // Fix 1: Get CSRF from response headers (standard method)
    const csrfToken = csrfRes.headers.get('x-csrf-token');
    if (!csrfToken) return res.status(400).json({ error: 'No CSRF token in headers—bad cookie?' });
    
    // Step 2: Transfer ownership
    // Fix 2: Correct fetch syntax (parentheses, not backticks)
    const transferRes = await fetch(`https://apis.roblox.com/groups/v1/groups/${groupId}/transfer-ownership`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        'RobloxTransferApiKey': process.env.ROBLOX_TRANSFER_API_KEY,
        'Cookie': fullCookie,  // Session for perms check
      },
      body: JSON.stringify({ newOwnerTargetId: newOwnerId }),
    });
    
    if (!transferRes.ok) {
      const err = await transferRes.text();
      return res.status(transferRes.status).json({ error: 'Transfer failed', details: err });
    }
    
    const data = await transferRes.json();
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}
