export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  // Get credentials from Vercel environment variables
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // Validate
  if (!adminUsername || !adminPassword) {
    console.error('Admin credentials not configured in environment variables');
    return res.status(500).json({ 
      success: false, 
      error: 'Server configuration error' 
    });
  }

  // Compare credentials (constant-time comparison recommended in production)
  if (username === adminUsername && password === adminPassword) {
    return res.status(200).json({ 
      success: true,
      message: 'Authentication successful'
    });
  }

  // Invalid credentials
  return res.status(401).json({ 
    success: false, 
    error: 'Invalid username or password' 
  });
}
