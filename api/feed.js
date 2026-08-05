import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  let userId = null;
  let followingIds = [];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;

      if (userId) {
        const { data: follows } = await supabaseAdmin
          .from('follows')
          .select('following_id')
          .eq('follower_id', userId);

        if (follows) {
          followingIds = follows.map(f => f.following_id);
        }
      }
    } catch (err) {
      // Token invalid, treat as guest
    }
  }

  const { action } = req.query;

  // ================================================================
  //  PERSONALIZED FEED (Logged-in users)
  // ================================================================
  if (req.method === 'GET' && action === 'feed') {
    const { limit = 50, offset = 0 } = req.query;
    const limitNum = Number(limit);
    const offsetNum = Number(offset);

    // 1. Get boosted prompts
    let boostedQuery = supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .eq('is_boosted', true)
      .order('created_at', { ascending: false });

    const { data: boosted, error: boostError } = await boostedQuery;

    if (boostError) {
      return res.status(500).json({ error: boostError.message });
    }

    // 2. Get IDs of prompts the user has already liked or saved
    let excludedIds = [];
    if (userId) {
      const { data: likedIdsData } = await supabaseAdmin
        .from('likes')
        .select('prompt_id')
        .eq('user_id', userId);

      const { data: savedIdsData } = await supabaseAdmin
        .from('saves')
        .select('prompt_id')
        .eq('user_id', userId);

      const likedIds = likedIdsData ? likedIdsData.map(l => l.prompt_id) : [];
      const savedIds = savedIdsData ? savedIdsData.map(s => s.prompt_id) : [];
      excludedIds = [...likedIds, ...savedIds];
    }

    // 3. Get regular prompts (non-boosted)
    let regularQuery = supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .eq('is_boosted', false)
      .order('created_at', { ascending: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    if (userId && excludedIds.length > 0) {
      regularQuery = regularQuery.not('id', 'in', `(${excludedIds.join(',')})`);
    }

    let { data: regular, error: regularError } = await regularQuery;

    if (regularError) {
      return res.status(500).json({ error: regularError.message });
    }

    // 4. If we didn't get enough prompts, fall back to showing ALL prompts (including liked/saved)
    if (regular.length < limitNum) {
      const { data: fallback } = await supabaseAdmin
        .from('prompts')
        .select('*', { count: 'exact' })
        .eq('is_published', true)
        .eq('is_boosted', false)
        .order('created_at', { ascending: false })
        .range(0, limitNum - 1);

      regular = fallback || [];
    }

    // 5. Combine boosted + regular
    let allPrompts = [...boosted, ...regular];

    // 6. Get likes/saves/comments for each prompt
    const promptsWithCounts = await Promise.all(
      allPrompts.map(async (prompt) => {
        const { count: likes } = await supabaseAdmin
          .from('likes')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        const { count: saves } = await supabaseAdmin
          .from('saves')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        const { count: comments } = await supabaseAdmin
          .from('comments')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id)
          .eq('is_hidden', false);

        let liked = false;
        let saved = false;
        if (userId) {
          const { data: like } = await supabaseAdmin
            .from('likes')
            .select('id')
            .eq('user_id', userId)
            .eq('prompt_id', prompt.id)
            .maybeSingle();
          liked = !!like;

          const { data: save } = await supabaseAdmin
            .from('saves')
            .select('id')
            .eq('user_id', userId)
            .eq('prompt_id', prompt.id)
            .maybeSingle();
          saved = !!save;
        }

        return {
          ...prompt,
          like_count: likes || 0,
          save_count: saves || 0,
          comment_count: comments || 0,
          liked,
          saved
        };
      })
    );

    // 🔥 BULK VIEW COUNT UPDATE (fixed — two-step approach)
    if (allPrompts.length > 0) {
      const promptIds = allPrompts.map(p => p.id);
      try {
        // 1. Get current view counts
        const { data: currentPrompts } = await supabaseAdmin
          .from('prompts')
          .select('id, view_count')
          .in('id', promptIds);

        if (currentPrompts && currentPrompts.length > 0) {
          // 2. Build update objects
          const updates = currentPrompts.map(p => ({
            id: p.id,
            view_count: (p.view_count || 0) + 1
          }));

          // 3. Update each one individually
          for (const update of updates) {
            await supabaseAdmin
              .from('prompts')
              .update({ view_count: update.view_count })
              .eq('id', update.id);
          }
        }
      } catch (err) {
        // Silently fail — views are non-critical
        console.warn('View count update failed:', err.message);
      }
    }

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: promptsWithCounts.length,
      hasMore: promptsWithCounts.length === Number(limit)
    });
  }

  // ================================================================
  //  SEARCH
  // ================================================================
  if (req.method === 'GET' && action === 'search') {
    const { q, limit = 20, offset = 0 } = req.query;

    if (!q || q.trim() === '') {
      return res.status(400).json({ error: 'Search query required' });
    }

    const searchTerm = q.trim();

    const { data: users, error: userError } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        username,
        display_name,
        avatar_url,
        is_premium,
        is_owner
      `)
      .or(`username.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%`)
      .limit(5);

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    const { data: prompts, error: promptError, count } = await supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,prompt_text.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (promptError) {
      return res.status(500).json({ error: promptError.message });
    }

    const promptsWithCounts = await Promise.all(
      prompts.map(async (prompt) => {
        const { count: likes } = await supabaseAdmin
          .from('likes')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        const { count: saves } = await supabaseAdmin
          .from('saves')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        return {
          ...prompt,
          like_count: likes || 0,
          save_count: saves || 0
        };
      })
    );

    return res.status(200).json({
      users: users || [],
      prompts: promptsWithCounts,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  // ================================================================
  //  EXPLORE (Guest feed)
  // ================================================================
  if (req.method === 'GET' && action === 'explore') {
    const { limit = 50, offset = 0 } = req.query;

    const { data: prompts, error, count } = await supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const promptsWithCounts = await Promise.all(
      prompts.map(async (prompt) => {
        const { count: likes } = await supabaseAdmin
          .from('likes')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        const { count: saves } = await supabaseAdmin
          .from('saves')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        return {
          ...prompt,
          like_count: likes || 0,
          save_count: saves || 0
        };
      })
    );

    // 🔥 BULK VIEW COUNT UPDATE (fixed — two-step approach)
    if (prompts.length > 0) {
      const promptIds = prompts.map(p => p.id);
      try {
        // 1. Get current view counts
        const { data: currentPrompts } = await supabaseAdmin
          .from('prompts')
          .select('id, view_count')
          .in('id', promptIds);

        if (currentPrompts && currentPrompts.length > 0) {
          // 2. Build update objects
          const updates = currentPrompts.map(p => ({
            id: p.id,
            view_count: (p.view_count || 0) + 1
          }));

          // 3. Update each one individually
          for (const update of updates) {
            await supabaseAdmin
              .from('prompts')
              .update({ view_count: update.view_count })
              .eq('id', update.id);
          }
        }
      } catch (err) {
        // Silently fail — views are non-critical
        console.warn('View count update failed:', err.message);
      }
    }

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
