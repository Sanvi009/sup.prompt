import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { action } = req.query;
  const { targetUserId } = req.query; // For viewing other profiles

  // ================================================================
  // GET PROFILE
  // ================================================================
  if (req.method === 'GET') {
    // If no targetUserId is provided, fall back to the authenticated user
    const id = targetUserId || userId;

    let { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        username,
        display_name,
        avatar_url,
        bio,
        is_premium,
        is_owner,
        created_at,
        last_username_change,
        last_display_name_change
      `)
      .eq('username', id)   // Treat id as username
      .single();

    // If username lookup fails, try UUID lookup
    if (error || !profile) {
      const { data: profileByUuid, error: uuidError } = await supabaseAdmin
        .from('profiles')
        .select(`
          id,
          username,
          display_name,
          avatar_url,
          bio,
          is_premium,
          is_owner,
          created_at,
          last_username_change,
          last_display_name_change
        `)
        .eq('id', id)
        .single();

      if (uuidError || !profileByUuid) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      // Override profile with UUID result
      profile = profileByUuid;
    }

    // Get counts
    const { count: likes } = await supabaseAdmin
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id);

    const { count: saves } = await supabaseAdmin
      .from('saves')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id);

    const { count: comments } = await supabaseAdmin
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('is_hidden', false);

    const { count: followers } = await supabaseAdmin
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', profile.id);

    const { count: following } = await supabaseAdmin
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', profile.id);

    // Check if current user follows this profile
    let isFollowing = false;
    if (targetUserId && targetUserId !== userId) {
      const { data: follow } = await supabaseAdmin
        .from('follows')
        .select('id')
        .eq('follower_id', userId)
        .eq('following_id', profile.id)
        .maybeSingle();
      isFollowing = !!follow;
    }

    return res.status(200).json({
      profile,
      stats: {
        likes: likes || 0,
        saves: saves || 0,
        comments: comments || 0,
        followers: followers || 0,
        following: following || 0
      },
      isFollowing
    });
  }

  // ================================================================
  // UPDATE PROFILE
  // ================================================================
  if (req.method === 'PUT') {
    const { display_name, bio, avatar_url } = req.body;

    const updates = {};
    
    // Check display_name change limit (twice a week)
    if (display_name !== undefined) {
      const { data: current } = await supabaseAdmin
        .from('profiles')
        .select('display_name, last_display_name_change')
        .eq('id', userId)
        .single();

      if (current.display_name !== display_name) {
        const now = new Date();
        if (current.last_display_name_change) {
          const lastChange = new Date(current.last_display_name_change);
          const diffDays = (now - lastChange) / (1000 * 60 * 60 * 24);
          if (diffDays < 3.5) { // Twice a week = every 3.5 days
            return res.status(429).json({ 
              error: 'You can change your display name twice a week only' 
            });
          }
        }
        updates.display_name = display_name;
        updates.last_display_name_change = now.toISOString();
      }
    }

    if (bio !== undefined) {
      updates.bio = bio;
    }

    if (avatar_url !== undefined) {
      updates.avatar_url = avatar_url;
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, profile: data });
  }

  // ================================================================
  // CHANGE USERNAME (once a month)
  // ================================================================
  if (req.method === 'POST' && action === 'change-username') {
    const { new_username } = req.body;

    if (!new_username || new_username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    // Check if username exists
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('username', new_username)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Check last change (once a month)
    const { data: current } = await supabaseAdmin
      .from('profiles')
      .select('username, last_username_change')
      .eq('id', userId)
      .single();

    if (current.username === new_username) {
      return res.status(400).json({ error: 'New username is the same as current' });
    }

    if (current.last_username_change) {
      const lastChange = new Date(current.last_username_change);
      const now = new Date();
      const diffDays = (now - lastChange) / (1000 * 60 * 60 * 24);
      if (diffDays < 30) {
        const daysLeft = Math.ceil(30 - diffDays);
        return res.status(429).json({ 
          error: `You can change your username once a month. ${daysLeft} days remaining.` 
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        username: new_username,
        last_username_change: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Generate new token with updated username
    const newToken = jwt.sign(
      { id: userId, username: new_username, is_owner: false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      token: newToken,
      profile: data
    });
  }

  // ================================================================
  // AVATAR UPLOAD (handled by Supabase Storage, just update URL)
  // ================================================================
  if (req.method === 'POST' && action === 'avatar') {
    const { avatar_url } = req.body;
    
    if (!avatar_url) {
      return res.status(400).json({ error: 'Avatar URL required' });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        avatar_url,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, avatar_url: data.avatar_url });
  }

  // ================================================================
  // DELETE AVATAR
  // ================================================================
  if (req.method === 'DELETE' && action === 'avatar') {
    // Get current avatar URL to delete from storage
    const { data: current } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    if (current?.avatar_url) {
      // Extract path from URL to delete from storage
      try {
        const url = new URL(current.avatar_url);
        const path = url.pathname.split('/').slice(2).join('/');
        if (path) {
          await supabaseAdmin.storage
            .from('user_avatars')
            .remove([path]);
        }
      } catch (err) {
        // Ignore storage errors
      }
    }

    // Update profile
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        avatar_url: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, profile: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
