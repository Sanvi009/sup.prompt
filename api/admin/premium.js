import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Admin auth check
  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const url = req.url;
  const method = req.method;
  const path = url.split('?')[0];
  const parts = path.split('/').filter(p => p !== '');
  // parts: ['api', 'admin', 'premium', userId]

  // ===== GET /api/admin/premium =====
  if (method === 'GET' && parts.length === 3) {
    try {
      const { filter = 'all', search = '', limit = 50, offset = 0 } = req.query;

      let query = supabase
        .from('users')
        .select(`
          id,
          username,
          nickname,
          profile_pic,
          role,
          premium_since,
          created_at
        `, { count: 'exact' });

      // Filter by role
      if (filter === 'premium') query = query.eq('role', 'premium');
      else if (filter === 'owner') query = query.eq('role', 'owner');
      else if (filter === 'user') query = query.eq('role', 'user');

      // Search
      if (search) {
        query = query.or(`username.ilike.%${search}%,nickname.ilike.%${search}%`);
      }

      query = query.order('created_at', { ascending: false });
      query = query.range(offset, offset + limit - 1);

      const { data: users, count, error } = await query;
      if (error) throw error;

      return res.status(200).json({
        users,
        total: count || 0,
        hasMore: (offset + limit) < count
      });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== PATCH /api/admin/premium/:userId =====
  if (method === 'PATCH' && parts.length === 4) {
    const userId = parts[3];
    try {
      const { role } = req.body;

      // Validate role
      if (!['user', 'premium', 'owner'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const updates = {
        role,
        premium_since: role === 'premium' || role === 'owner' ? new Date() : null
      };

      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;

      return res.status(200).json({ success: true });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(404).json({ error: 'Route not found' });
}
