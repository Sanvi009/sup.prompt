// /api/auth/login.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if banned
    if (user.is_banned) {
      return res.status(403).json({ 
        error: 'Account suspended',
        ban_note: user.ban_note || 'Your account has been suspended'
      });
    }

    // Verify password using pgcrypto
    const { data: verifyResult, error: verifyError } = await supabase
      .rpc('verify_password', {
        password: password,
        hash: user.password_hash
      });

    if (verifyError || !verifyResult) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create session
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Delete old sessions
    await supabase
      .from('sessions')
      .delete()
      .eq('user_id', user.id);

    // Create new session
    await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        token: token,
        expires_at: expiresAt
      });

    // Set cookie
    res.setHeader('Set-Cookie', `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_premium: user.is_premium,
        is_owner: user.is_owner
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
