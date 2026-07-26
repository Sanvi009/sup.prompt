// /api/admin/premium.js
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
    // ========== GET: Get all premium/owner users ==========
    if (method === 'GET') {
      const { type } = query;

      let queryBuilder = supabase
        .from('users')
        .select('id, username, display_name, avatar_url, is_premium, is_owner');

      if (type === 'premium') {
        queryBuilder = queryBuilder.eq('is_premium', true);
      } else if (type === 'owner') {
        queryBuilder = queryBuilder.eq('is_owner', true);
      } else {
        queryBuilder = queryBuilder.or('is_premium.eq.true,is_owner.eq.true');
      }

      const { data: users, error } = await queryBuilder;

      if (error) throw error;

      return res.status(200).json({ users: users || [] });
    }

    // ========== PUT: Set premium/owner status ==========
    if (method === 'PUT') {
      const { userId, action } = body;

      if (!userId || !action) {
        return res.status(400).json({ error: 'User ID and action required' });
      }

      let updateData = {};

      if (action === 'set_premium') {
        updateData = { is_premium: true };
      } else if (action === 'remove_premium') {
        updateData = { is_premium: false };
      } else if (action === 'set_owner') {
        updateData = { is_owner: true };
      } else if (action === 'remove_owner') {
        updateData = { is_owner: false };
      } else {
        return res.status(400).json({ error: 'Invalid action' });
      }

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId);

      if (error) throw error;

      return res.status(200).json({ success: true });
    }

    // ========== GET: Search users for premium selection ==========
    if (method === 'GET' && query.search) {
      const { search } = query;

      const { data: users, error } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url, is_premium, is_owner')
        .ilike('username', `%${search}%`)
        .limit(10);

      if (error) throw error;

      return res.status(200).json({ users: users || [] });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Premium management error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
