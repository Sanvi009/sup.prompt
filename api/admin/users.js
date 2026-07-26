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

  // Parse the URL to determine what action to take
  const url = req.url;
  const method = req.method;
  
  // Remove query params for path matching
  const path = url.split('?')[0];
  const parts = path.split('/').filter(p => p !== '');
  
  // parts[0] = 'api', parts[1] = 'admin', parts[2] = 'users', parts[3] = userId, parts[4] = action, parts[5] = actionId

  // If no userId, it's a list users request
  if (parts.length === 3) {
    // GET /api/admin/users - List users with stats
    if (method === 'GET') {
      try {
        const { filter = 'newest', search = '', limit = 50, offset = 0 } = req.query;

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

        if (search) {
          queryBuilder = queryBuilder.or(`username.ilike.%${search}%,nickname.ilike.%${search}%`);
        }

        switch (filter) {
          case 'newest': queryBuilder = queryBuilder.order('created_at', { ascending: false }); break;
          case 'oldest': queryBuilder = queryBuilder.order('created_at', { ascending: true }); break;
          case 'banned': queryBuilder = queryBuilder.eq('is_banned', true); break;
          case 'premium': queryBuilder = queryBuilder.eq('role', 'premium'); break;
          default: queryBuilder = queryBuilder.order('created_at', { ascending: false });
        }

        queryBuilder = queryBuilder.range(offset, offset + limit - 1);

        const { data: users, count, error } = await queryBuilder;
        if (error) throw error;

        const usersWithStats = await Promise.all(users.map(async (user) => {
          const [followers, following, totalLikes, totalSaves, totalComments] = await Promise.all([
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
          hasMore: (offset + limit) < count
        });

      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  }

  // If we have userId
  if (parts.length >= 4) {
    const userId = parts[3];
    const action = parts[4] || null;
    const actionId = parts[5] || null;

    // ===== DELETE USER =====
    if (method === 'DELETE' && !action) {
      try {
        const { data: user } = await supabase.from('users').select('profile_pic').eq('id', userId).single();
        const { error } = await supabase.from('users').delete().eq('id', userId);
        if (error) throw error;
        
        if (user?.profile_pic && !user.profile_pic.includes('default-avatar')) {
          const path = user.profile_pic.split('/profile_pics/')[1];
          if (path) await supabase.storage.from('profile_pics').remove([path]);
        }
        return res.status(200).json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // ===== BAN USER =====
    if (method === 'POST' && action === 'ban') {
      try {
        const { note } = req.body;
        const { error } = await supabase
          .from('users')
          .update({ is_banned: true, ban_note: note || 'Banned by admin' })
          .eq('id', userId);
        if (error) throw error;
        return res.status(200).json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // ===== GET LIKES =====
    if (method === 'GET' && action === 'likes' && !actionId) {
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

    // ===== DELETE LIKE =====
    if (method === 'DELETE' && action === 'likes' && actionId) {
      try {
        const { error } = await supabase
          .from('likes')
          .delete()
          .eq('id', actionId)
          .eq('user_id', userId);
        if (error) throw error;
        return res.status(200).json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // ===== GET SAVES =====
    if (method === 'GET' && action === 'saves' && !actionId) {
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

    // ===== DELETE SAVE =====
    if (method === 'DELETE' && action === 'saves' && actionId) {
      try {
        const { error } = await supabase
          .from('saves')
          .delete()
          .eq('id', actionId)
          .eq('user_id', userId);
        if (error) throw error;
        return res.status(200).json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // ===== GET COMMENTS =====
    if (method === 'GET' && action === 'comments' && !actionId) {
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

    // ===== HIDE COMMENT =====
    if (method === 'PATCH' && action === 'comments' && actionId) {
      try {
        const { is_hidden } = req.body;
        const { error } = await supabase
          .from('comments')
          .update({ is_hidden })
          .eq('id', actionId)
          .eq('user_id', userId);
        if (error) throw error;
        return res.status(200).json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // ===== DELETE COMMENT =====
    if (method === 'DELETE' && action === 'comments' && actionId) {
      try {
        const { error } = await supabase
          .from('comments')
          .delete()
          .eq('id', actionId)
          .eq('user_id', userId);
        if (error) throw error;
        return res.status(200).json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  }

  // If no route matched
  return res.status(404).json({ error: 'Route not found' });
}
