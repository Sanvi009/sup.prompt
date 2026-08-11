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

    // 1. Get boosted prompts
    let query = supabaseAdmin
      .from('prompts')
      .select('id, slug, title, description, image_main, view_count, created_at, is_boosted, category_ids', { count: 'exact' })
      .eq('is_published', true)
      .eq('is_boosted', true)
      .order('created_at', { ascending: false });

    const { data: boosted, error: boostError } = await query;

    if (boostError) {
      return res.status(500).json({ error: boostError.message });
    }

    // 2. Get regular prompts (non-boosted)
    let regularQuery = supabaseAdmin
      .from('prompts')
      .select('id, slug, title, description, image_main, view_count, created_at, is_boosted, category_ids', { count: 'exact' })
      .eq('is_published', true)
      .eq('is_boosted', false)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data: regular, error: regularError } = await regularQuery;

    if (regularError) {
      return res.status(500).json({ error: regularError.message });
    }

    let allPrompts = [...boosted, ...regular];

    // 3. Personalize for logged-in users
    if (userId) {
      const { data: userLikes } = await supabaseAdmin
        .from('likes')
        .select('prompt_id')
        .eq('user_id', userId);

      const { data: userSaves } = await supabaseAdmin
        .from('saves')
        .select('prompt_id')
        .eq('user_id', userId);

      const likedIds = userLikes ? userLikes.map(l => l.prompt_id) : [];
      const savedIds = userSaves ? userSaves.map(s => s.prompt_id) : [];

      const scored = allPrompts.map(prompt => {
        let score = 0;

        if (followingIds.length > 0) {
          // Placeholder for future creator_id support
        }

        if (!likedIds.includes(prompt.id)) {
          score += 5;
        }
        if (!savedIds.includes(prompt.id)) {
          score += 3;
        }

        if (prompt.is_boosted) {
          score += 50;
        }

        const daysOld = (Date.now() - new Date(prompt.created_at).getTime()) / (1000 * 60 * 60 * 24);
        score += Math.max(0, 10 - daysOld);

        return { ...prompt, _score: score };
      });

      scored.sort((a, b) => b._score - a._score);
      allPrompts = scored.map(({ _score, ...prompt }) => prompt);
      allPrompts = allPrompts.slice(0, Number(limit));
    }

    // 4. Batch check: Did the user like/save these prompts?
    let likedMap = {};
    let savedMap = {};
    if (userId && allPrompts.length > 0) {
      const promptIds = allPrompts.map(p => p.id);
      
      const { data: likesData } = await supabaseAdmin
        .from('likes')
        .select('prompt_id')
        .eq('user_id', userId)
        .in('prompt_id', promptIds);

      const { data: savesData } = await supabaseAdmin
        .from('saves')
        .select('prompt_id')
        .eq('user_id', userId)
        .in('prompt_id', promptIds);

      likesData?.forEach(l => { likedMap[l.prompt_id] = true; });
      savesData?.forEach(s => { savedMap[s.prompt_id] = true; });
    }

    // 5. Map the final data (NO LIKES/SAVES/COMMENT COUNTS IN FEED)
    const promptsWithState = allPrompts.map(prompt => ({
      ...prompt,
      liked: likedMap[prompt.id] || false,
      saved: savedMap[prompt.id] || false
    }));

    // 6. Batch insert views into the views table (triggers auto-update view_count)
    if (promptsWithState.length > 0) {
      const viewInserts = promptsWithState.map(p => ({ prompt_id: p.id }));
      await supabaseAdmin.from('views').insert(viewInserts).select();
    }

    // 7. Get Creative Peoples suggestions (for logged-in users only)
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
      prompts: promptsWithState,
      suggestions: suggestions,
      total: promptsWithState.length,
      hasMore: promptsWithState.length === Number(limit)
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
      .select('id, slug, title, description, image_main, view_count, created_at, is_boosted, category_ids', { count: 'exact' })
      .eq('is_published', true)
      .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,prompt_text.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (promptError) {
      return res.status(500).json({ error: promptError.message });
    }

    // No counts needed - just return the prompts
    return res.status(200).json({
      users: users || [],
      prompts: prompts || [],
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
      .select('id, slug, title, description, image_main, view_count, created_at, is_boosted, category_ids', { count: 'exact' })
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Batch insert views into the views table (triggers auto-update view_count)
    if (prompts.length > 0) {
      const viewInserts = prompts.map(p => ({ prompt_id: p.id }));
      await supabaseAdmin.from('views').insert(viewInserts).select();
    }

    return res.status(200).json({
      prompts: prompts || [],
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
