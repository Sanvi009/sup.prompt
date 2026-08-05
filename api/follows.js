import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
  const { targetUserId } = req.body;

  // ============================================================
  //  FOLLOW
  // ============================================================
  if (req.method === 'POST' && action === 'follow') {
    if (!targetUserId) {
      return res.status(400).json({ error: 'Target user ID required' });
    }

    if (targetUserId === userId) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }

    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', targetUserId)
      .single();

    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: existing } = await supabaseAdmin
      .from('follows')
      .select('id')
      .eq('follower_id', userId)
      .eq('following_id', targetUserId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Already following this user' });
    }

    const { data, error } = await supabaseAdmin
      .from('follows')
      .insert({
        follower_id: userId,
        following_id: targetUserId
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ success: true, follow: data });
  }

  // ============================================================
  //  UNFOLLOW
  // ============================================================
  if (req.method === 'DELETE' && action === 'unfollow') {
    if (!targetUserId) {
      return res.status(400).json({ error: 'Target user ID required' });
    }

    const { error } = await supabaseAdmin
      .from('follows')
      .delete()
      .eq('follower_id', userId)
      .eq('following_id', targetUserId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  // ============================================================
  //  GET FOLLOWERS  ✅ FIXED (two-step query, no join)
  // ============================================================
  if (req.method === 'GET' && action === 'followers') {
    const { userId: targetId } = req.query;

    if (!targetId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Step 1: Get follower IDs and timestamps
    const { data: follows, error: followsError } = await supabaseAdmin
      .from('follows')
      .select('follower_id, created_at')
      .eq('following_id', targetId)
      .order('created_at', { ascending: false });

    if (followsError) {
      return res.status(500).json({ error: followsError.message });
    }

    if (follows.length === 0) {
      return res.status(200).json({ followers: [] });
    }

    // Step 2: Fetch profile data for all follower IDs in one go
    const followerIds = follows.map(f => f.follower_id);
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, display_name, avatar_url, is_premium, is_owner')
      .in('id', followerIds);

    if (profilesError) {
      return res.status(500).json({ error: profilesError.message });
    }

    // Step 3: Combine follow data with profile data
    const followers = follows.map(f => {
      const profile = profiles.find(p => p.id === f.follower_id);
      return {
        follower_id: f.follower_id,
        created_at: f.created_at,
        profiles: profile || null
      };
    });

    return res.status(200).json({ followers });
  }

  // ============================================================
  //  GET FOLLOWING  ✅ FIXED (two-step query, no join)
  // ============================================================
  if (req.method === 'GET' && action === 'following') {
    const { userId: targetId } = req.query;

    if (!targetId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Step 1: Get following IDs and timestamps
    const { data: follows, error: followsError } = await supabaseAdmin
      .from('follows')
      .select('following_id, created_at')
      .eq('follower_id', targetId)
      .order('created_at', { ascending: false });

    if (followsError) {
      return res.status(500).json({ error: followsError.message });
    }

    if (follows.length === 0) {
      return res.status(200).json({ following: [] });
    }

    // Step 2: Fetch profile data for all following IDs in one go
    const followingIds = follows.map(f => f.following_id);
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, display_name, avatar_url, is_premium, is_owner')
      .in('id', followingIds);

    if (profilesError) {
      return res.status(500).json({ error: profilesError.message });
    }

    // Step 3: Combine follow data with profile data
    const following = follows.map(f => {
      const profile = profiles.find(p => p.id === f.following_id);
      return {
        following_id: f.following_id,
        created_at: f.created_at,
        profiles: profile || null
      };
    });

    return res.status(200).json({ following });
  }

  // ============================================================
  //  FOLLOW STATUS  ✅ UNCHANGED
  // ============================================================
  if (req.method === 'GET' && action === 'status') {
    const { targetId } = req.query;

    if (!targetId) {
      return res.status(400).json({ error: 'Target user ID required' });
    }

    const { data: follow } = await supabaseAdmin
      .from('follows')
      .select('id')
      .eq('follower_id', userId)
      .eq('following_id', targetId)
      .maybeSingle();

    return res.status(200).json({
      isFollowing: !!follow
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
