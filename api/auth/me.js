// /api/auth/me.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const token = req.cookies?.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // Get session with user
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('user_id, expires_at, users(*)')
      .eq('token', token)
      .single();

    if (sessionError || !session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      // Delete expired session
      await supabase
        .from('sessions')
        .delete()
        .eq('token', token);
      
      return res.status(401).json({ error: 'Session expired' });
    }

    const user = session.users;

    // Check if banned
    if (user.is_banned) {
      return res.status(403).json({ 
        error: 'Account suspended',
        ban_note: user.ban_note || 'Your account has been suspended'
      });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        bio: user.bio,
        is_premium: user.is_premium,
        is_owner: user.is_owner,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('Auth check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
