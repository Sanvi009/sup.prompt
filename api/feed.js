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

  // ================================================================
  //  PERSONALIZED FEED (Logged-in users)
  // ================================================================
  if (req.method === 'GET' && action === 'feed') {
    const { limit = 50, offset = 0 } = req.query;

    // 1. Get boosted prompts
    let query = supabaseAdmin
      .from('prompts')
      .select('id, slug, title, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted, category_ids', { count: 'exact' })
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
      .select('id, slug, title, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted, category_ids', { count: 'exact' })
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

    // 4. Get likes/saves/comments for each prompt
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

    // 5. Get Creative Peoples suggestions (for logged-in users only)
    let suggestions = [];
    if (userId) {
      try {
        // Get top users by follower count
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
          // Get follower counts for each user
          const usersWithFollowers = await Promise.all(
            topUsers.map(async (user) => {
              const { count: followers } = await supabaseAdmin
                .from('follows')
                .select('*', { count: 'exact', head: true })
                .eq('following_id', user.id);
              return { ...user, followers: followers || 0 };
            })
          );

          // Sort by follower count (highest first)
          usersWithFollowers.sort((a, b) => b.followers - a.followers);

          // Filter out already followed users and the current user
          const available = usersWithFollowers.filter(u => 
            u.id !== userId && !followingIds.includes(u.id)
          );

          // Get top 20, then pick 4 random
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
      .select('id, slug, title, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted, category_ids', { count: 'exact' })
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
      .select('id, slug, title, image_main, view_count, like_count, save_count, comment_count, created_at, is_boosted, category_ids', { count: 'exact' })
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
