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

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch (err) {
      // Token invalid, treat as guest
    }
  }

  const { action } = req.query;

  // ================================================================
  //  PERSONALIZED FEED (Logged-in users)
  // ================================================================
  if (req.method === 'GET' && action === 'feed') {
    const { limit = 50, offset = 0, filter = 'all' } = req.query;

    // ===== Build the query based on filter =====
    let query = supabaseAdmin
      .from('prompts')
      .select('id, slug, title, description, image_main, view_count, created_at, is_boosted, category_ids', { count: 'exact' })
      .eq('is_published', true);

    // Apply ordering based on filter
    if (filter === 'all') {
      // Boosted first, then newest
      query = query
        .order('is_boosted', { ascending: false })
        .order('created_at', { ascending: false });
    } else if (filter === 'latest') {
      // Pure newest first (no boost)
      query = query.order('created_at', { ascending: false });
    } else if (filter === 'oldest') {
      // Oldest first
      query = query.order('created_at', { ascending: true });
    } else if (filter === 'most_liked') {
      // Highest like_count first
      query = query.order('like_count', { ascending: false });
    } else if (filter === 'most_saved') {
      // Highest save_count first
      query = query.order('save_count', { ascending: false });
    } else if (filter === 'most_viewed') {
      // Highest view_count first
      query = query.order('view_count', { ascending: false });
    } else if (filter === 'most_commented') {
      // Highest comment_count first
      query = query.order('comment_count', { ascending: false });
    } else {
      // Fallback to 'all'
      query = query
        .order('is_boosted', { ascending: false })
        .order('created_at', { ascending: false });
    }

    // Apply pagination
    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data: allPrompts, error: queryError, count } = await query;

    if (queryError) {
      return res.status(500).json({ error: queryError.message });
    }

    // 2. Batch check: Did the user like/save these prompts?
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

    // 3. Map the final data (NO LIKES/SAVES/COMMENT COUNTS IN FEED)
    const promptsWithState = allPrompts.map(prompt => ({
      ...prompt,
      liked: likedMap[prompt.id] || false,
      saved: savedMap[prompt.id] || false
    }));

    // 4. Batch insert views into the views table (triggers auto-update view_count)
    if (promptsWithState.length > 0) {
      const viewInserts = promptsWithState.map(p => ({ prompt_id: p.id }));
      await supabaseAdmin.from('views').insert(viewInserts).select();
    }

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

          // Filter out the current user
          const available = usersWithFollowers.filter(u => u.id !== userId);

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
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
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
    const { limit = 50, offset = 0, filter = 'all' } = req.query;

    // ===== Build the query based on filter (same as feed) =====
    let query = supabaseAdmin
      .from('prompts')
      .select('id, slug, title, description, image_main, view_count, created_at, is_boosted, category_ids', { count: 'exact' })
      .eq('is_published', true);

    // Apply ordering based on filter
    if (filter === 'all') {
      // Boosted first, then newest
      query = query
        .order('is_boosted', { ascending: false })
        .order('created_at', { ascending: false });
    } else if (filter === 'latest') {
      // Pure newest first (no boost)
      query = query.order('created_at', { ascending: false });
    } else if (filter === 'oldest') {
      // Oldest first
      query = query.order('created_at', { ascending: true });
    } else if (filter === 'most_liked') {
      // Highest like_count first
      query = query.order('like_count', { ascending: false });
    } else if (filter === 'most_saved') {
      // Highest save_count first
      query = query.order('save_count', { ascending: false });
    } else if (filter === 'most_viewed') {
      // Highest view_count first
      query = query.order('view_count', { ascending: false });
    } else if (filter === 'most_commented') {
      // Highest comment_count first
      query = query.order('comment_count', { ascending: false });
    } else {
      // Fallback to 'all'
      query = query
        .order('is_boosted', { ascending: false })
        .order('created_at', { ascending: false });
    }

    // Apply pagination
    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data: prompts, error, count } = await query;

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
