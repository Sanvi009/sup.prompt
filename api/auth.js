import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Default avatar URL (stored in Supabase storage)
const DEFAULT_AVATAR_URL = 'https://txubevnsqchnzaztppfb.supabase.co/storage/v1/object/public/default/default.jpg';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;


  if (action === 'register') {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('username', username)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .insert({
        username,
        display_name: username,
        avatar_url: DEFAULT_AVATAR_URL,
        bio: '',
        is_premium: false,
        is_owner: false,
        is_banned: false,
        ban_note: null,
        last_username_change: null,
        last_display_name_change: null
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const { error: pwdError } = await supabaseAdmin
      .from('auth_passwords')
      .insert({
        user_id: profile.id,
        password_hash: hashedPassword
      });

    if (pwdError) {
      await supabaseAdmin.from('profiles').delete().eq('id', profile.id);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    const token = jwt.sign(
      { id: profile.id, username: profile.username, is_owner: false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        is_premium: profile.is_premium,
        is_owner: profile.is_owner,
        is_banned: profile.is_banned
      }
    });
  }

  if (action === 'login') {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // ===== ADMIN LOGIN (UPDATED TO FETCH REAL UUID) =====
    if (username === adminUsername && password === adminPassword) {
      // Fetch the admin's real profile from the database
      const { data: adminProfile, error: adminError } = await supabaseAdmin
        .from('profiles')
        .select('id, username')
        .eq('username', adminUsername)
        .single();

      // If the admin profile doesn't exist in the database, fallback to 'admin' (safe fallback)
      if (adminError || !adminProfile) {
        const token = jwt.sign(
          { id: 'admin', username: adminUsername, is_owner: true },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );

        return res.status(200).json({
          success: true,
          token,
          user: {
            id: 'admin',
            username: adminUsername,
            display_name: 'Admin (Owner)',
            avatar_url: null,
            is_premium: false,
            is_owner: true,
            is_banned: false
          }
        });
      }

      // Sign the token with the REAL UUID from the database
      const token = jwt.sign(
        { id: adminProfile.id, username: adminProfile.username, is_owner: true },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: adminProfile.id,
          username: adminProfile.username,
          display_name: 'Admin (Owner)',
          avatar_url: null,
          is_premium: false,
          is_owner: true,
          is_banned: false
        }
      });
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !profile) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (profile.is_banned) {
      return res.status(403).json({
        error: 'Account banned',
        ban_note: profile.ban_note || 'Your account has been banned'
      });
    }

    const { data: pwdData } = await supabaseAdmin
      .from('auth_passwords')
      .select('password_hash')
      .eq('user_id', profile.id)
      .single();

    if (!pwdData) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, pwdData.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: profile.id, username: profile.username, is_owner: false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        is_premium: profile.is_premium,
        is_owner: profile.is_owner,
        is_banned: profile.is_banned
      }
    });
  }

  if (action === 'verify') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // If the admin token still has 'admin' as id (fallback), handle it
      if (decoded.id === 'admin') {
        return res.status(200).json({
          success: true,
          user: {
            id: 'admin',
            username: decoded.username,
            display_name: 'Admin (Owner)',
            avatar_url: null,
            is_premium: false,
            is_owner: true,
            is_banned: false
          }
        });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', decoded.id)
        .single();

      if (!profile) {
        return res.status(401).json({ error: 'User not found' });
      }

      if (profile.is_banned) {
        return res.status(403).json({
          error: 'Account banned',
          ban_note: profile.ban_note
        });
      }

      return res.status(200).json({
        success: true,
        user: {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          is_premium: profile.is_premium,
          is_owner: profile.is_owner,
          is_banned: profile.is_banned
        }
      });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  if (action === 'logout') {
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
