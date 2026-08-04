import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Global try/catch to prevent ANY server crash
  try {
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

      // ===== NEW: Insert follow notification =====
      await supabaseAdmin
        .from('notifications')
        .insert({
          recipient_id: targetUserId,
          actor_id: userId,
          type: 'follow',
          target_id: targetUserId
        });
      // ==========================================

      return res.status(201).json({ success: true, follow: data });
    }

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

    if (req.method === 'GET' && action === 'followers') {
      const { userId: targetId } = req.query;

      if (!targetId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      const { data: followers, error } = await supabaseAdmin
        .from('follows')
        .select(`
          follower_id,
          created_at,
          profiles:follower_id (
            id,
            username,
            display_name,
            avatar_url,
            is_premium,
            is_owner
          )
        `)
        .eq('following_id', targetId)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ followers });
    }

    if (req.method === 'GET' && action === 'following') {
      const { userId: targetId } = req.query;

      if (!targetId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      try {
        const { data: following, error } = await supabaseAdmin
          .from('follows')
          .select(`
            following_id,
            created_at,
            profiles:following_id (
              id,
              username,
              display_name,
              avatar_url,
              is_premium,
              is_owner
            )
          `)
          .eq('follower_id', targetId)
          .order('created_at', { ascending: false });

        if (error) {
          // If there's a database error, return an empty array instead of crashing
          return res.status(200).json({ following: [] });
        }

        return res.status(200).json({ following: following || [] });
      } catch (err) {
        // Catch any unexpected server errors and return empty array
        return res.status(200).json({ following: [] });
      }
    }

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

  } catch (err) {
    // GLOBAL CATCH: If ANYTHING crashes, return this instead of a 500
    console.error('Global follows.js error:', err);
    return res.status(200).json({ following: [] });
  }
}
