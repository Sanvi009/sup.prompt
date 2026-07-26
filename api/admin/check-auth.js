export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check for admin_auth cookie
  const cookies = req.headers.cookie || '';
  const hasAdminAuth = cookies.includes('admin_auth=true');

  return res.status(200).json({
    authenticated: hasAdminAuth
  });
}
