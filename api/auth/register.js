// /api/auth/register.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password, display_name } = req.body;

  // Validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Username: only letters, numbers, underscore, 3-20 chars
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ 
      error: 'Username must be 3-20 characters and contain only letters, numbers, or underscore' 
    });
  }

  // Password: min 6 chars, 1 uppercase, 1 lowercase, 1 number
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ 
      error: 'Password must be at least 6 characters with 1 uppercase, 1 lowercase, and 1 number' 
    });
  }

  // Display name: default to username if not provided
  const displayName = display_name || username;

  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // Check if username already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Hash the password using pgcrypto via Supabase
    const { data: hashResult, error: hashError } = await supabase
      .rpc('crypt', { 
        password: password, 
        salt: 'bf' 
      });

    if (hashError) {
      console.error('Hash error:', hashError);
      return res.status(500).json({ error: 'Registration failed' });
    }

    // Create user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        username: username,
        display_name: displayName,
        password_hash: hashResult,
        avatar_url: 'https://via.placeholder.com/150',
        bio: '',
        created_at: new Date()
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(500).json({ error: 'Registration failed' });
    }

    // Create session
    const token = require('crypto').randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await supabase
      .from('sessions')
      .insert({
        user_id: newUser.id,
        token: token,
        expires_at: expiresAt
      });

    // Set cookie
    res.setHeader('Set-Cookie', `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);

    return res.status(201).json({ 
      success: true, 
      user: {
        id: newUser.id,
        username: newUser.username,
        display_name: newUser.display_name,
        avatar_url: newUser.avatar_url
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
