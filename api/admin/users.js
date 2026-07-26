import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check admin auth
  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { method, query, body } = req;
  const userId = query.userId;

  // ===== GET: List users with stats =====
  if (method === 'GET') {
    try {
      const { filter = 'newest', search = '', limit = 50, offset = 0 } = query;

      // Build the query
      let queryBuilder = supabase
        .from('users')
        .select(`
          id,
          username,
          nickname,
          bio,
          profile_pic,
          role,
          is_banned,
          ban_note,
          created_at,
          premium_since
        `, { count: 'exact' });

      // Apply search
      if (search) {
        queryBuilder = queryBuilder.or(`username.ilike.%${search}%,nickname.ilike.%${search}%`);
      }

      // Apply filter
      switch (filter) {
        case 'newest':
          queryBuilder = queryBuilder.order('created_at', { ascending: false });
          break;
        case 'oldest':
          queryBuilder = queryBuilder.order('created_at', { ascending: true });
          break;
        case 'banned':
          queryBuilder = queryBuilder.eq('is_banned', true);
          break;
        case 'premium':
          queryBuilder = queryBuilder.eq('role', 'premium');
          break;
        default:
          queryBuilder = queryBuilder.order('created_at', { ascending: false });
      }

      // Pagination
      queryBuilder = queryBuilder.range(offset, offset + limit - 1);

      const { data: users, count, error } = await queryBuilder;

      if (error) throw error;

      // Get stats for each user
      const usersWithStats = await Promise.all(users.map(async (user) => {
        const [
          followers,
          following,
          totalLikes,
          totalSaves,
          totalComments
        ] = await Promise.all([
          supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user.id),
          supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', user.id),
          supabase.from('likes').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('saves').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('comments').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
        ]);

        return {
          ...user,
          followers: followers.count || 0,
          following: following.count || 0,
          totalLikes: totalLikes.count || 0,
          totalSaves: totalSaves.count || 0,
          totalComments: totalComments.count || 0
        };
      }));

      return res.status(200).json({
        users: usersWithStats,
        total: count || 0,
        page: Math.floor(offset / limit) + 1,
        hasMore: (offset + limit) < count
      });

    } catch (error) {
      console.error('Users API error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== DELETE: Delete user permanently =====
  if (method === 'DELETE' && userId) {
    try {
      // Get user's profile pic to delete from storage
      const { data: user } = await supabase
        .from('users')
        .select('profile_pic')
        .eq('id', userId)
        .single();

      // Delete user (cascades to all related data)
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (error) throw error;

      // Delete profile pic from storage if not default
      if (user?.profile_pic && !user.profile_pic.includes('default-avatar')) {
        const path = user.profile_pic.split('/profile_pics/')[1];
        if (path) {
          await supabase.storage.from('profile_pics').remove([path]);
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== POST: Ban user =====
  if (method === 'POST' && userId && req.url.includes('/ban')) {
    try {
      const { note } = body;

      const { error } = await supabase
        .from('users')
        .update({ is_banned: true, ban_note: note || 'Banned by admin' })
        .eq('id', userId);

      if (error) throw error;

      // Store ban note in admin_notes
      await supabase
        .from('admin_notes')
        .insert({
          user_id: userId,
          admin_id: 'admin', // You can get actual admin ID if needed
          note: note || 'Banned by admin'
        });

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== GET: User's likes =====
  if (method === 'GET' && userId && req.url.includes('/likes')) {
    try {
      const { data: likes, error } = await supabase
        .from('likes')
        .select(`
          id,
          created_at,
          prompts:prompt_id (
            id,
            prompt_id,
            title,
            image_main
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.status(200).json({ likes });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== GET: User's saves =====
  if (method === 'GET' && userId && req.url.includes('/saves')) {
    try {
      const { data: saves, error } = await supabase
        .from('saves')
        .select(`
          id,
          created_at,
          prompts:prompt_id (
            id,
            prompt_id,
            title,
            image_main
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.status(200).json({ saves });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== GET: User's comments =====
  if (method === 'GET' && userId && req.url.includes('/comments')) {
    try {
      const { data: comments, error } = await supabase
        .from('comments')
        .select(`
          id,
          content,
          is_hidden,
          created_at,
          prompts:prompt_id (
            id,
            prompt_id,
            title
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.status(200).json({ comments });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== DELETE: Remove specific like =====
  if (method === 'DELETE' && userId && req.url.includes('/likes/')) {
    try {
      const likeId = req.url.split('/likes/')[1];
      
      const { error } = await supabase
        .from('likes')
        .delete()
        .eq('id', likeId)
        .eq('user_id', userId);

      if (error) throw error;

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== DELETE: Remove specific save =====
  if (method === 'DELETE' && userId && req.url.includes('/saves/')) {
    try {
      const saveId = req.url.split('/saves/')[1];
      
      const { error } = await supabase
        .from('saves')
        .delete()
        .eq('id', saveId)
        .eq('user_id', userId);

      if (error) throw error;

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== PATCH: Hide comment =====
  if (method === 'PATCH' && userId && req.url.includes('/comments/')) {
    try {
      const commentId = req.url.split('/comments/')[1];
      const { is_hidden } = body;

      const { error } = await supabase
        .from('comments')
        .update({ is_hidden })
        .eq('id', commentId)
        .eq('user_id', userId);

      if (error) throw error;

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== DELETE: Delete comment =====
  if (method === 'DELETE' && userId && req.url.includes('/comments/')) {
    try {
      const commentId = req.url.split('/comments/')[1];
      
      const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', userId);

      if (error) throw error;

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
