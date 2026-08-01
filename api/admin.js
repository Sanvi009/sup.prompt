import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.is_owner) {
      return res.status(403).json({ error: 'Forbidden — Admin access required' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const adminId = decoded.id;
  const { action } = req.query;

  // ================================================================
  // SECTION 1: DASHBOARD STATS
  // ================================================================
  if (action === 'dashboard') {
    const { count: totalUsers } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: totalPrompts } = await supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('is_published', true);

    const { count: totalLikes } = await supabaseAdmin
      .from('likes')
      .select('*', { count: 'exact', head: true });

    const { count: totalSaves } = await supabaseAdmin
      .from('saves')
      .select('*', { count: 'exact', head: true });

    const { count: totalComments } = await supabaseAdmin
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('is_hidden', false);

    const { data: mostLiked } = await supabaseAdmin
      .from('prompts')
      .select('id, title, slug, like_count')
      .eq('is_published', true)
      .order('like_count', { ascending: false })
      .limit(1);

    const { data: mostSaved } = await supabaseAdmin
      .from('prompts')
      .select('id, title, slug, save_count')
      .eq('is_published', true)
      .order('save_count', { ascending: false })
      .limit(1);

    const { data: mostCommented } = await supabaseAdmin
      .from('prompts')
      .select('id, title, slug, comment_count')
      .eq('is_published', true)
      .order('comment_count', { ascending: false })
      .limit(1);

    const { count: pendingReports } = await supabaseAdmin
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    return res.status(200).json({
      stats: {
        totalUsers: totalUsers || 0,
        totalPrompts: totalPrompts || 0,
        totalLikes: totalLikes || 0,
        totalSaves: totalSaves || 0,
        totalComments: totalComments || 0,
        pendingReports: pendingReports || 0,
        mostLiked: mostLiked?.[0] || null,
        mostSaved: mostSaved?.[0] || null,
        mostCommented: mostCommented?.[0] || null
      }
    });
  }

  // ================================================================
  // SECTION 2: USER MANAGEMENT
  // ================================================================
  if (action === 'users') {
    const subAction = req.query.sub;

    // --- LIST USERS (with filters) ---
    if (subAction === 'list') {
      const { filter, limit = 50, offset = 0 } = req.query;

      let query = supabaseAdmin
        .from('profiles')
        .select(`
          id,
          username,
          display_name,
          avatar_url,
          bio,
          is_premium,
          is_owner,
          is_banned,
          ban_note,
          created_at,
          updated_at
        `, { count: 'exact' });

      // Apply filters
      if (filter === 'newest') {
        query = query.order('created_at', { ascending: false });
      } else if (filter === 'oldest') {
        query = query.order('created_at', { ascending: true });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      const { data: users, error, count } = await query
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const usersWithCounts = await Promise.all(
        users.map(async (user) => {
          const { count: likes } = await supabaseAdmin
            .from('likes')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

          const { count: saves } = await supabaseAdmin
            .from('saves')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

          const { count: comments } = await supabaseAdmin
            .from('comments')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('is_hidden', false);

          const { count: followers } = await supabaseAdmin
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('following_id', user.id);

          const { count: following } = await supabaseAdmin
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('follower_id', user.id);

          return {
            ...user,
            stats: {
              likes: likes || 0,
              saves: saves || 0,
              comments: comments || 0,
              followers: followers || 0,
              following: following || 0
            }
          };
        })
      );

      return res.status(200).json({
        users: usersWithCounts,
        total: count || 0,
        hasMore: (Number(offset) + Number(limit)) < (count || 0)
      });
    }

    // --- SEARCH USERS ---
    if (subAction === 'search') {
      const { q } = req.query;

      if (!q || q.trim() === '') {
        return res.status(400).json({ error: 'Search query required' });
      }

      const { data: users, error } = await supabaseAdmin
        .from('profiles')
        .select(`
          id,
          username,
          display_name,
          avatar_url,
          is_premium,
          is_owner,
          is_banned,
          ban_note,
          created_at
        `)
        .or(`username.ilike.%${q.trim()}%,display_name.ilike.%${q.trim()}%`)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ users });
    }

    // --- BAN USER ---
    if (subAction === 'ban') {
      const { userId, note } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      if (userId === adminId) {
        return res.status(400).json({ error: 'You cannot ban yourself' });
      }

      const { data: user } = await supabaseAdmin
        .from('profiles')
        .select('id, is_banned')
        .eq('id', userId)
        .single();

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.is_banned) {
        return res.status(409).json({ error: 'User is already banned' });
      }

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          is_banned: true,
          ban_note: note || 'Banned by admin',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      await supabaseAdmin
        .from('bans')
        .insert({
          user_id: userId,
          admin_id: adminId,
          note: note || 'Banned by admin'
        });

      return res.status(200).json({
        success: true,
        message: 'User banned successfully'
      });
    }

    // --- UNBAN USER ---
    if (subAction === 'unban') {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      const { data: user } = await supabaseAdmin
        .from('profiles')
        .select('id, is_banned')
        .eq('id', userId)
        .single();

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.is_banned) {
        return res.status(409).json({ error: 'User is not banned' });
      }

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          is_banned: false,
          ban_note: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        message: 'User unbanned successfully'
      });
    }

    // --- DELETE USER (permanent) ---
    if (subAction === 'delete') {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      if (userId === adminId) {
        return res.status(400).json({ error: 'You cannot delete yourself' });
      }

      const { data: user } = await supabaseAdmin
        .from('profiles')
        .select('id, avatar_url')
        .eq('id', userId)
        .single();

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.avatar_url) {
        try {
          const url = new URL(user.avatar_url);
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

      const { error } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        message: 'User deleted permanently'
      });
    }

    // --- GET USER DETAILS (with likes/saves/comments) ---
    if (subAction === 'details') {
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      const { data: user } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { data: likedPrompts } = await supabaseAdmin
        .from('likes')
        .select(`
          prompt_id,
          created_at,
          prompts:prompt_id (
            id,
            slug,
            title,
            image_main,
            like_count,
            save_count
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      const { data: savedPrompts } = await supabaseAdmin
        .from('saves')
        .select(`
          prompt_id,
          created_at,
          prompts:prompt_id (
            id,
            slug,
            title,
            image_main,
            like_count,
            save_count
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      const { data: comments } = await supabaseAdmin
        .from('comments')
        .select(`
          id,
          prompt_id,
          content,
          likes_count,
          created_at,
          prompts:prompt_id (
            id,
            slug,
            title
          )
        `)
        .eq('user_id', userId)
        .eq('is_hidden', false)
        .order('created_at', { ascending: false });

      return res.status(200).json({
        user,
        likes: likedPrompts || [],
        saves: savedPrompts || [],
        comments: comments || []
      });
    }

    // --- REMOVE LIKE FROM USER ---
    if (subAction === 'remove-like') {
      const { userId, promptId } = req.body;

      if (!userId || !promptId) {
        return res.status(400).json({ error: 'User ID and Prompt ID required' });
      }

      const { error } = await supabaseAdmin
        .from('likes')
        .delete()
        .eq('user_id', userId)
        .eq('prompt_id', promptId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      await supabaseAdmin
        .from('prompts')
        .update({ like_count: prompt.like_count - 1 })
        .eq('id', promptId);

      return res.status(200).json({
        success: true,
        message: 'Like removed'
      });
    }

    // --- REMOVE SAVE FROM USER ---
    if (subAction === 'remove-save') {
      const { userId, promptId } = req.body;

      if (!userId || !promptId) {
        return res.status(400).json({ error: 'User ID and Prompt ID required' });
      }

      const { error } = await supabaseAdmin
        .from('saves')
        .delete()
        .eq('user_id', userId)
        .eq('prompt_id', promptId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      await supabaseAdmin
        .from('prompts')
        .update({ save_count: prompt.save_count - 1 })
        .eq('id', promptId);

      return res.status(200).json({
        success: true,
        message: 'Save removed'
      });
    }

    // --- HIDE COMMENT ---
    if (subAction === 'hide-comment') {
      const { commentId } = req.body;

      if (!commentId) {
        return res.status(400).json({ error: 'Comment ID required' });
      }

      const { error } = await supabaseAdmin
        .from('comments')
        .update({ is_hidden: true })
        .eq('id', commentId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        message: 'Comment hidden'
      });
    }

    // --- DELETE COMMENT (permanent) ---
    if (subAction === 'delete-comment') {
      const { commentId } = req.body;

      if (!commentId) {
        return res.status(400).json({ error: 'Comment ID required' });
      }

      const { data: comment } = await supabaseAdmin
        .from('comments')
        .select('prompt_id')
        .eq('id', commentId)
        .single();

      const { error } = await supabaseAdmin
        .from('comments')
        .delete()
        .eq('id', commentId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      if (comment) {
        await supabaseAdmin
          .from('prompts')
          .update({ comment_count: prompt.comment_count - 1 })
          .eq('id', comment.prompt_id);
      }

      return res.status(200).json({
        success: true,
        message: 'Comment deleted permanently'
      });
    }

    return res.status(400).json({ error: 'Invalid sub-action for users' });
  }

  // ================================================================
  // SECTION 3: PROMPT MANAGEMENT
  // ================================================================
  if (action === 'prompts') {
    const subAction = req.query.sub;

    // --- LIST PROMPTS (admin view) ---
    if (subAction === 'list') {
      const { limit = 50, offset = 0, published } = req.query;

      let query = supabaseAdmin
        .from('prompts')
        .select('*', { count: 'exact' });

      if (published === 'true') {
        query = query.eq('is_published', true);
      } else if (published === 'false') {
        query = query.eq('is_published', false);
      }

      const { data: prompts, error, count } = await query
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

          const { count: comments } = await supabaseAdmin
            .from('comments')
            .select('*', { count: 'exact', head: true })
            .eq('prompt_id', prompt.id)
            .eq('is_hidden', false);

          return {
            ...prompt,
            like_count: likes || 0,
            save_count: saves || 0,
            comment_count: comments || 0
          };
        })
      );

      return res.status(200).json({
        prompts: promptsWithCounts,
        total: count || 0,
        hasMore: (Number(offset) + Number(limit)) < (count || 0)
      });
    }

    // --- GET SINGLE PROMPT (admin) ---
    if (subAction === 'get') {
      const { promptId } = req.body;

      if (!promptId) {
        return res.status(400).json({ error: 'Prompt ID required' });
      }

      const { data: prompt, error } = await supabaseAdmin
        .from('prompts')
        .select('*')
        .eq('id', promptId)
        .single();

      if (error || !prompt) {
        return res.status(404).json({ error: 'Prompt not found' });
      }

      const { data: likes } = await supabaseAdmin
        .from('likes')
        .select(`
          user_id,
          created_at,
          profiles:user_id (
            id,
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('prompt_id', promptId);

      const { data: saves } = await supabaseAdmin
        .from('saves')
        .select(`
          user_id,
          created_at,
          profiles:user_id (
            id,
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('prompt_id', promptId);

      const { data: comments } = await supabaseAdmin
        .from('comments')
        .select(`
          id,
          user_id,
          content,
          likes_count,
          created_at,
          profiles:user_id (
            id,
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('prompt_id', promptId)
        .eq('is_hidden', false)
        .order('created_at', { ascending: false });

      return res.status(200).json({
        prompt,
        likes: likes || [],
        saves: saves || [],
        comments: comments || []
      });
    }

    // --- EDIT PROMPT ---
    if (subAction === 'edit') {
      const { promptId, title, description, prompt_text, category_ids, image_main, image_optional } = req.body;

      if (!promptId) {
        return res.status(400).json({ error: 'Prompt ID required' });
      }

      const updates = { updated_at: new Date().toISOString() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (prompt_text !== undefined) updates.prompt_text = prompt_text;
      if (category_ids !== undefined) updates.category_ids = category_ids;
      if (image_main !== undefined) updates.image_main = image_main;
      if (image_optional !== undefined) updates.image_optional = image_optional;

      const { data, error } = await supabaseAdmin
        .from('prompts')
        .update(updates)
        .eq('id', promptId)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        prompt: data
      });
    }

    // --- PUBLISH/UNPUBLISH PROMPT ---
    if (subAction === 'publish') {
      const { promptId, publish } = req.body;

      if (!promptId) {
        return res.status(400).json({ error: 'Prompt ID required' });
      }

      const { data, error } = await supabaseAdmin
        .from('prompts')
        .update({
          is_published: publish,
          updated_at: new Date().toISOString()
        })
        .eq('id', promptId)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        prompt: data,
        message: publish ? 'Prompt published' : 'Prompt unpublished'
      });
    }

    // --- BOOST/UNBOOST PROMPT ---
    if (subAction === 'boost') {
      const { promptId, boost } = req.body;

      if (!promptId) {
        return res.status(400).json({ error: 'Prompt ID required' });
      }

      const { data, error } = await supabaseAdmin
        .from('prompts')
        .update({
          is_boosted: boost,
          updated_at: new Date().toISOString()
        })
        .eq('id', promptId)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        prompt: data,
        message: boost ? 'Prompt boosted' : 'Prompt unboosted'
      });
    }

    // --- DELETE PROMPT (permanent) ---
    if (subAction === 'delete') {
      const { promptId } = req.body;

      if (!promptId) {
        return res.status(400).json({ error: 'Prompt ID required' });
      }

      try {
        const { data: fileList, error: listError } = await supabaseAdmin
          .storage
          .from('prompt_images')
          .list('', { limit: 100, offset: 0 });

        if (!listError && fileList) {
          const filesToDelete = fileList
            .filter(file => file.name.startsWith(promptId))
            .map(file => file.name);

          if (filesToDelete.length > 0) {
            await supabaseAdmin.storage
              .from('prompt_images')
              .remove(filesToDelete);
          }
        }
      } catch (err) {
        console.warn('Failed to delete images for prompt', promptId, err);
      }

      const { error } = await supabaseAdmin
        .from('prompts')
        .delete()
        .eq('id', promptId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        message: 'Prompt deleted permanently'
      });
    }

    return res.status(400).json({ error: 'Invalid sub-action for prompts' });
  }

  // ================================================================
  // SECTION 4: PREMIUM MANAGEMENT
  // ================================================================
  if (action === 'premium') {
    const subAction = req.query.sub;

    // --- LIST ALL PREMIUM USERS ---
    if (subAction === 'list') {
      const { data: premiumUsers, error } = await supabaseAdmin
        .from('premium_users')
        .select(`
          id,
          type,
          granted_at,
          profiles:user_id (
            id,
            username,
            display_name,
            avatar_url,
            is_premium,
            is_owner
          )
        `)
        .order('granted_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ premiumUsers: premiumUsers || [] });
    }

    // --- GRANT PREMIUM/OWNER ---
    if (subAction === 'grant') {
      const { userId, type } = req.body;

      if (!userId || !type) {
        return res.status(400).json({ error: 'User ID and type required' });
      }

      if (!['premium', 'owner'].includes(type)) {
        return res.status(400).json({ error: 'Type must be "premium" or "owner"' });
      }

      // 🔥 FIX: Skip database lookup if userId is 'admin'
      if (userId !== 'admin') {
        const { data: user } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', userId)
          .single();

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
      }

      // Check if already premium
      const { data: existing } = await supabaseAdmin
        .from('premium_users')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        return res.status(409).json({ error: 'User is already premium/owner' });
      }

      // Grant premium
      const { error } = await supabaseAdmin
        .from('premium_users')
        .insert({
          user_id: userId,
          type,
          granted_by_admin_id: adminId
        });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Update profile
      await supabaseAdmin
        .from('profiles')
        .update({
          is_premium: type === 'premium' || type === 'owner',
          is_owner: type === 'owner',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      return res.status(201).json({
        success: true,
        message: `User marked as ${type}`
      });
    }

    // --- REMOVE PREMIUM/OWNER ---
    if (subAction === 'remove') {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      const { error } = await supabaseAdmin
        .from('premium_users')
        .delete()
        .eq('user_id', userId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      await supabaseAdmin
        .from('profiles')
        .update({
          is_premium: false,
          is_owner: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      return res.status(200).json({
        success: true,
        message: 'Premium/Owner status removed'
      });
    }

    return res.status(400).json({ error: 'Invalid sub-action for premium' });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
