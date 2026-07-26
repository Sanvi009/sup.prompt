import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
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
  // parts: ['api', 'admin', 'reports-users', reportId]

  // ===== GET /api/admin/reports-users =====
  if (method === 'GET' && parts.length === 3) {
    try {
      const { filter = 'unresolved', limit = 50, offset = 0 } = req.query;

      let query = supabase
        .from('reports_users')
        .select(`
          id,
          reason,
          created_at,
          is_resolved,
          reporter:reporter_id (
            id,
            username,
            nickname,
            profile_pic
          ),
          reported_user:reported_user_id (
            id,
            username,
            nickname,
            profile_pic
          )
        `, { count: 'exact' });

      if (filter === 'unresolved') query = query.eq('is_resolved', false);
      else if (filter === 'resolved') query = query.eq('is_resolved', true);

      query = query.order('created_at', { ascending: false });
      query = query.range(offset, offset + limit - 1);

      const { data: reports, count, error } = await query;
      if (error) throw error;

      return res.status(200).json({
        reports,
        total: count || 0,
        hasMore: (offset + limit) < count
      });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== PATCH /api/admin/reports-users/:reportId/resolve =====
  if (method === 'PATCH' && parts.length === 4 && parts[3] === 'resolve') {
    const reportId = parts[2];
    try {
      const { is_resolved } = req.body;
      const { error } = await supabase
        .from('reports_users')
        .update({ is_resolved })
        .eq('id', reportId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== DELETE /api/admin/reports-users/:reportId =====
  if (method === 'DELETE' && parts.length === 4) {
    const reportId = parts[3];
    try {
      const { error } = await supabase
        .from('reports_users')
        .delete()
        .eq('id', reportId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(404).json({ error: 'Route not found' });
}
