// /api/auth/logout.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.cookies?.auth_token;

  if (token) {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Delete session
    await supabase
      .from('sessions')
      .delete()
      .eq('token', token);
  }

  // Clear cookie
  res.setHeader('Set-Cookie', `auth_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

  return res.status(200).json({ success: true });
}
