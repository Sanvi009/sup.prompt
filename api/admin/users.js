// /api/admin/users.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify admin token
  const adminToken = req.cookies?.admin_token;
  if (!adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { method, query, body } = req;

  try {
    // ========== GET: List all users with filters ==========
    if (method === 'GET') {
      const { filter, search, page = 0, limit = 20 } = query;

      let queryBuilder = supabase
        .from('users')
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
          likes:likes(count),
          saves:saves(count),
          comments:comments(count)
        `);

      // Search by username
      if (search) {
        queryBuilder = queryBuilder.ilike('username', `%${search}%`);
      }

      // Filters
      if (filter === 'new') {
        queryBuilder = queryBuilder.order('created_at', { ascending: false });
      } else if (filter === 'old') {
        queryBuilder = queryBuilder.order('created_at', { ascending: true });
      } else if (filter === 'most_liked') {
        queryBuilder = queryBuilder.order('likes', { ascending: false });
      } else if (filter === 'most_saved') {
        queryBuilder = queryBuilder.order('saves', { ascending: false });
      } else if (filter === 'most_commented') {
        queryBuilder = queryBuilder.order('comments', { ascending: false });
      } else {
        queryBuilder = queryBuilder.order('created_at', { ascending: false });
      }

      // Pagination
      queryBuilder = queryBuilder
        .range(page * limit, (page + 1) * limit - 1);

      const { data: users, error, count } = await queryBuilder;

      if (error) throw error;

      return res.status(200).json({
        users: users || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit)
      });
    }

    // ========== PUT: Ban/Unban user ==========
    if (method === 'PUT') {
      const { userId, action, banNote } = body;

      if (!userId || !action) {
        return res.status(400).json({ error: 'User ID and action required' });
      }

      if (action === 'ban') {
        const { error } = await supabase
          .from('users')
          .update({
            is_banned: true,
            ban_note: banNote || 'Violation of community guidelines'
          })
          .eq('id', userId);

        if (error) throw error;
        return res.status(200).json({ success: true, message: 'User banned' });
      }

      if (action === 'unban') {
        const { error } = await supabase
          .from('users')
          .update({
            is_banned: false,
            ban_note: null
          })
          .eq('id', userId);

        if (error) throw error;
        return res.status(200).json({ success: true, message: 'User unbanned' });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    // ========== DELETE: Delete user permanently ==========
    if (method === 'DELETE') {
      const { userId } = query;

      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      // Delete user (cascade will delete all related data)
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (error) throw error;

      return res.status(200).json({ success: true, message: 'User deleted permanently' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('User management error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
