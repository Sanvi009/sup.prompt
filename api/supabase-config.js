// /api/supabase-config.js
export default function handler(req, res) {
  // Set CORS headers so your frontend can access it
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Return the environment variables (these are safe because they're server-side)
  res.status(200).json({
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY
  });
}
