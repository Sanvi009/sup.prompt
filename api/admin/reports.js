// /api/admin/reports.js
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

  const { method, query } = req;

  try {
    if (method === 'GET') {
      const { type, page = 0, limit = 20 } = query;

      let queryBuilder = supabase
        .from('reports')
        .select(`
          id,
          reason,
          is_resolved,
          created_at,
          reporter:reporter_id (
            id,
            username,
            display_name,
            avatar_url
          ),
          reported_user:reported_user_id (
            id,
            username,
            display_name,
            avatar_url
          ),
          reported_prompt:reported_prompt_id (
            id,
            title,
            slug,
            image_main
          )
        `)
        .order('created_at', { ascending: false });

      // Filter by type
      if (type === 'user') {
        queryBuilder = queryBuilder.not('reported_user_id', 'is', null);
      } else if (type === 'prompt') {
        queryBuilder = queryBuilder.not('reported_prompt_id', 'is', null);
      }

      // Pagination
      queryBuilder = queryBuilder
        .range(page * limit, (page + 1) * limit - 1);

      const { data: reports, error } = await queryBuilder;

      if (error) throw error;

      return res.status(200).json({
        reports: reports || [],
        page: parseInt(page),
        limit: parseInt(limit)
      });
    }

    // ========== DELETE: Delete a report ==========
    if (method === 'DELETE') {
      const { reportId } = query;

      if (!reportId) {
        return res.status(400).json({ error: 'Report ID required' });
      }

      const { error } = await supabase
        .from('reports')
        .delete()
        .eq('id', reportId);

      if (error) throw error;

      return res.status(200).json({ success: true, message: 'Report deleted' });
    }

    // ========== PUT: Resolve a report ==========
    if (method === 'PUT') {
      const { reportId, resolved } = body;

      if (!reportId) {
        return res.status(400).json({ error: 'Report ID required' });
      }

      const { error } = await supabase
        .from('reports')
        .update({ is_resolved: resolved })
        .eq('id', reportId);

      if (error) throw error;

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Reports error:', error);
    return res.status(500).json({ error: 'Failed to fetch reports' });
  }
}
