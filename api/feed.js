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
    const { limit = 10, offset = 0 } = req.query;
    const limitNum = Number(limit) || 10;
    const offsetNum = Number(offset) || 0;

    // --- If user is not logged in, return explore feed ---
    if (!userId) {
      // Redirect to explore
      return exploreFeed(req, res);
    }

    // ================================================================
    // STEP 1: Get user's category weights
    // ================================================================
    const { data: categoryWeights, error: weightError } = await supabaseAdmin
      .from('user_category_weights')
      .select('category_id, weight')
      .eq('user_id', userId)
      .order('weight', { ascending: false });

    if (weightError) {
      return res.status(500).json({ error: weightError.message });
    }

    const hasWeights = categoryWeights && categoryWeights.length > 0;

    // ================================================================
    // STEP 2: Get user's liked/saved/commented prompt IDs (to exclude)
    // ================================================================
    const { data: likedIdsData } = await supabaseAdmin
      .from('likes')
      .select('prompt_id')
      .eq('user_id', userId);

    const { data: savedIdsData } = await supabaseAdmin
      .from('saves')
      .select('prompt_id')
      .eq('user_id', userId);

    const { data: commentedIdsData } = await supabaseAdmin
      .from('comments')
      .select('prompt_id')
      .eq('user_id', userId)
      .eq('is_hidden', false);

    const likedIds = likedIdsData ? likedIdsData.map(l => l.prompt_id) : [];
    const savedIds = savedIdsData ? savedIdsData.map(s => s.prompt_id) : [];
    const commentedIds = commentedIdsData ? commentedIdsData.map(c => c.prompt_id) : [];
    const excludedIds = [...likedIds, ...savedIds, ...commentedIds];

    // ================================================================
    // STEP 3: Determine how many prompts to take from each bucket
    // ================================================================
    // First page: 10 prompts, subsequent: 20
    // 60% personalized, 25% trending, 15% random
    let personalizedCount = Math.floor(limitNum * 0.60);
    let trendingCount = Math.floor(limitNum * 0.25);
    let randomCount = Math.floor(limitNum * 0.15);

    // Adjust for rounding (ensure sum equals limit)
    const sum = personalizedCount + trendingCount + randomCount;
    if (sum < limitNum) {
      personalizedCount += (limitNum - sum); // Add remaining to personalized
    }

    // ================================================================
    // STEP 4: Get personalized prompts
    // ================================================================
    let personalizedPrompts = [];
    if (hasWeights && personalizedCount > 0) {
      // Get top category IDs from weights
      const topCategoryIds = categoryWeights.slice(0, 10).map(c => c.category_id);

      // Query prompts that match these categories, excluding already interacted ones
      const { data: personalized, error: pError } = await supabaseAdmin
        .from('prompts')
        .select('*')
        .eq('is_published', true)
        .eq('is_boosted', false)
        .not('id', 'in', `(${excludedIds.length > 0 ? excludedIds.join(',') : 'null'})`)
        .order('created_at', { ascending: false })
        .limit(personalizedCount * 3); // Fetch more than needed, then score

      if (!pError && personalized) {
        // Score each prompt based on category match
        const scored = personalized.map(prompt => {
          let score = 0;
          if (prompt.category_ids && prompt.category_ids.length > 0) {
            // Sum weights of matching categories
            const matchingCategories = prompt.category_ids.filter(id => 
              topCategoryIds.includes(id)
            );
            if (matchingCategories.length > 0) {
              // Get actual weights for matching categories
              const matchingWeights = categoryWeights
                .filter(c => matchingCategories.includes(c.category_id))
                .reduce((sum, c) => sum + c.weight, 0);
              score += matchingWeights;
            }
          }

          // Bonus for following
          if (followingIds.length > 0 && prompt.creator_id && followingIds.includes(prompt.creator_id)) {
            score += 20;
          }

          // Recency bonus
          const daysOld = (Date.now() - new Date(prompt.created_at).getTime()) / (1000 * 60 * 60 * 24);
          score += Math.max(0, 15 - daysOld);

          return { ...prompt, _score: score };
        });

        scored.sort((a, b) => b._score - a._score);
        personalizedPrompts = scored.slice(0, personalizedCount);
      }
    }

    // If user has no weights or not enough personalized prompts, fill with recent prompts
    if (personalizedPrompts.length < personalizedCount) {
      const remaining = personalizedCount - personalizedPrompts.length;
      const { data: recent } = await supabaseAdmin
        .from('prompts')
        .select('*')
        .eq('is_published', true)
        .eq('is_boosted', false)
        .not('id', 'in', `(${excludedIds.length > 0 ? excludedIds.join(',') : 'null'})`)
        .order('created_at', { ascending: false })
        .limit(remaining);

      if (recent) {
        personalizedPrompts = [...personalizedPrompts, ...recent];
      }
    }

    // ================================================================
    // STEP 5: Get trending prompts
    // ================================================================
    let trendingPrompts = [];
    if (trendingCount > 0) {
      const { data: trending, error: tError } = await supabaseAdmin
        .from('prompts')
        .select('*')
        .eq('is_published', true)
        .eq('is_boosted', false)
        .not('id', 'in', `(${excludedIds.length > 0 ? excludedIds.join(',') : 'null'})`)
        .order('like_count', { ascending: false })
        .limit(trendingCount);

      if (!tError && trending) {
        trendingPrompts = trending;
      }
    }

    // ================================================================
    // STEP 6: Get random prompts
    // ================================================================
    let randomPrompts = [];
    if (randomCount > 0) {
      const { data: random, error: rError } = await supabaseAdmin
        .from('prompts')
        .select('*')
        .eq('is_published', true)
        .eq('is_boosted', false)
        .not('id', 'in', `(${excludedIds.length > 0 ? excludedIds.join(',') : 'null'})`)
        .order('created_at', { ascending: false })
        .limit(randomCount * 3);

      if (!rError && random) {
        // Shuffle and pick randomCount
        const shuffled = random.sort(() => 0.5 - Math.random());
        randomPrompts = shuffled.slice(0, randomCount);
      }
    }

    // ================================================================
    // STEP 7: Combine all buckets
    // ================================================================
    let allPrompts = [...personalizedPrompts, ...trendingPrompts, ...randomPrompts];

    // Deduplicate by id
    const seen = new Set();
    allPrompts = allPrompts.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    // If we have fewer than limit, fill with recent prompts
    if (allPrompts.length < limitNum) {
      const remaining = limitNum - allPrompts.length;
      const { data: morePrompts } = await supabaseAdmin
        .from('prompts')
        .select('*')
        .eq('is_published', true)
        .eq('is_boosted', false)
        .not('id', 'in', `(${excludedIds.length > 0 ? excludedIds.join(',') : 'null'})`)
        .order('created_at', { ascending: false })
        .limit(remaining);

      if (morePrompts) {
        allPrompts = [...allPrompts, ...morePrompts];
      }
    }

    // ================================================================
    // STEP 8: Add boosted prompts at the very top
    // ================================================================
    const { data: boosted, error: boostError } = await supabaseAdmin
      .from('prompts')
      .select('*')
      .eq('is_published', true)
      .eq('is_boosted', true)
      .order('created_at', { ascending: false });

    if (boostError) {
      return res.status(500).json({ error: boostError.message });
    }

    allPrompts = [...(boosted || []), ...allPrompts];

    // ================================================================
    // STEP 9: Get likes/saves/comments for each prompt
    // ================================================================
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

    // 🔥 BULK VIEW COUNT UPDATE
    if (allPrompts.length > 0) {
      const promptIds = allPrompts.map(p => p.id);
      try {
        const { data: currentPrompts } = await supabaseAdmin
          .from('prompts')
          .select('id, view_count')
          .in('id', promptIds);

        if (currentPrompts && currentPrompts.length > 0) {
          for (const p of currentPrompts) {
            await supabaseAdmin
              .from('prompts')
              .update({ view_count: (p.view_count || 0) + 1 })
              .eq('id', p.id);
          }
        }
      } catch (err) {
        console.warn('View count update failed:', err.message);
      }
    }

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: promptsWithCounts.length,
      hasMore: true // Simplified: always assume there's more
    });
  }

  // ================================================================
  //  EXPLORE (Guest feed) - UNCHANGED
  // ================================================================
  async function exploreFeed(req, res) {
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

    // 🔥 BULK VIEW COUNT UPDATE
    if (prompts.length > 0) {
      const promptIds = prompts.map(p => p.id);
      try {
        const { data: currentPrompts } = await supabaseAdmin
          .from('prompts')
          .select('id, view_count')
          .in('id', promptIds);

        if (currentPrompts && currentPrompts.length > 0) {
          for (const p of currentPrompts) {
            await supabaseAdmin
              .from('prompts')
              .update({ view_count: (p.view_count || 0) + 1 })
              .eq('id', p.id);
          }
        }
      } catch (err) {
        console.warn('View count update failed:', err.message);
      }
    }

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  // ================================================================
  //  SEARCH - UNCHANGED
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
  //  EXPLORE (Guest feed) - UNCHANGED
  // ================================================================
  if (req.method === 'GET' && action === 'explore') {
    return exploreFeed(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
