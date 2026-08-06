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
        // Only fetch following IDs (needed for Creative Peoples filtering)
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
  //  FEED (Logged-in users)
  // ================================================================
  if (req.method === 'GET' && action === 'feed') {
    const { limit = 10, offset = 0 } = req.query;

    // 1. Get boosted prompts
    const { data: boosted, error: boostError } = await supabaseAdmin
      .from('prompts')
      .select('id, slug, title, description, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted')
      .eq('is_published', true)
      .eq('is_boosted', true)
      .order('created_at', { ascending: false });

    if (boostError) {
      return res.status(500).json({ error: boostError.message });
    }

    // 2. Get regular prompts (non-boosted) - latest 10
    const { data: regular, error: regularError } = await supabaseAdmin
      .from('prompts')
      .select('id, slug, title, description, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted')
      .eq('is_published', true)
      .eq('is_boosted', false)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (regularError) {
      return res.status(500).json({ error: regularError.message });
    }

    let allPrompts = [...boosted, ...regular];

    // 3. Add liked/saved status for logged-in users (batched)
    let likedIds = [];
    let savedIds = [];

    if (userId && allPrompts.length > 0) {
      const promptIds = allPrompts.map(p => p.id);

      const { data: likes } = await supabaseAdmin
        .from('likes')
        .select('prompt_id')
        .eq('user_id', userId)
        .in('prompt_id', promptIds);

      const { data: saves } = await supabaseAdmin
        .from('saves')
        .select('prompt_id')
        .eq('user_id', userId)
        .in('prompt_id', promptIds);

      likedIds = likes ? likes.map(l => l.prompt_id) : [];
      savedIds = saves ? saves.map(s => s.prompt_id) : [];
    }

    // 4. Build final prompt list with counts from stored columns
    const promptsWithCounts = allPrompts.map(prompt => ({
      ...prompt,
      like_count: prompt.like_count || 0,
      save_count: prompt.save_count || 0,
      comment_count: prompt.comment_count || 0,
      liked: userId ? likedIds.includes(prompt.id) : false,
      saved: userId ? savedIds.includes(prompt.id) : false
    }));

    // 5. Get Creative Peoples suggestions (for logged-in users only)
    let suggestions = [];
    if (userId) {
      try {
        const { data: topUsers, error: topError } = await supabaseAdmin
          .from('profiles')
          .select(`
            id,
            username,
            display_name,
            avatar_url,
            is_premium,
            is_owner
          `)
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!topError && topUsers && topUsers.length > 0) {
          const usersWithFollowers = await Promise.all(
            topUsers.map(async (user) => {
              const { count: followers } = await supabaseAdmin
                .from('follows')
                .select('*', { count: 'exact', head: true })
                .eq('following_id', user.id);
              return { ...user, followers: followers || 0 };
            })
          );

          usersWithFollowers.sort((a, b) => b.followers - a.followers);

          const available = usersWithFollowers.filter(u => 
            u.id !== userId && !followingIds.includes(u.id)
          );

          const top20 = available.slice(0, 20);
          const shuffled = top20.sort(() => Math.random() - 0.5);
          suggestions = shuffled.slice(0, 4);
        }
      } catch (err) {
        console.warn('Failed to fetch suggestions:', err.message);
      }
    }

    return res.status(200).json({
      prompts: promptsWithCounts,
      suggestions: suggestions,
      total: promptsWithCounts.length,
      hasMore: regular.length === Number(limit)
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
      .select('id, slug, title, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted')
      .eq('is_published', true)
      .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,prompt_text.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (promptError) {
      return res.status(500).json({ error: promptError.message });
    }

    const promptsWithCounts = prompts.map(prompt => ({
      ...prompt,
      like_count: prompt.like_count || 0,
      save_count: prompt.save_count || 0
    }));

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
    const { limit = 10, offset = 0 } = req.query;

    const { data: prompts, error, count } = await supabaseAdmin
      .from('prompts')
      .select('id, slug, title, description, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const promptsWithCounts = prompts.map(prompt => ({
      ...prompt,
      like_count: prompt.like_count || 0,
      save_count: prompt.save_count || 0
    }));

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
