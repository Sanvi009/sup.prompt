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
  let userCategories = [];
  let followingIds = [];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;

      if (userId) {
        const { data: activity } = await supabaseAdmin
          .from('user_activity')
          .select('category_id, action_type')
          .eq('user_id', userId);

        if (activity && activity.length > 0) {
          const categoryCounts = {};
          activity.forEach(a => {
            if (a.category_id) {
              const key = a.category_id;
              if (!categoryCounts[key]) categoryCounts[key] = 0;
              categoryCounts[key] += 1;
            }
          });

          userCategories = Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0]);
        }

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

  if (req.method === 'GET' && action === 'feed') {
    const { limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .eq('is_boosted', true)
      .order('created_at', { ascending: false });

    const { data: boosted, error: boostError } = await query;

    if (boostError) {
      return res.status(500).json({ error: boostError.message });
    }

    let regularQuery = supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .eq('is_boosted', false)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data: regular, error: regularError } = await regularQuery;

    if (regularError) {
      return res.status(500).json({ error: regularError.message });
    }

    let allPrompts = [...boosted, ...regular];

    if (userId && userCategories.length > 0) {
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

        if (prompt.category_ids && prompt.category_ids.length > 0) {
          const matchedCategories = prompt.category_ids.filter(id => 
            userCategories.includes(id)
          );
          score += matchedCategories.length * 10;
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

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: promptsWithCounts.length,
      hasMore: promptsWithCounts.length === Number(limit)
    });
  }

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

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}