import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    const userId = req.query.id;

    // GET - Load comments
    if (req.method === 'GET') {
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
    }

    // PATCH - Hide a comment
    if (req.method === 'PATCH') {
      const { commentId } = req.query;
      const { is_hidden } = req.body;

      if (!commentId) {
        return res.status(400).json({ error: 'Missing commentId parameter' });
      }

      const { error } = await supabase
        .from('comments')
        .update({ is_hidden })
        .eq('id', commentId)
        .eq('user_id', userId);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    // DELETE - Delete a comment permanently
    if (req.method === 'DELETE') {
      const { commentId } = req.query;
      if (!commentId) {
        return res.status(400).json({ error: 'Missing commentId parameter' });
      }

      const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', userId);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
