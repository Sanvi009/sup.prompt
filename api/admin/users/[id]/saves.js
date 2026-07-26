import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
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

    // GET - Load saves
    if (req.method === 'GET') {
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
    }

    // DELETE - Remove a specific save
    if (req.method === 'DELETE') {
      const { saveId } = req.query;
      if (!saveId) {
        return res.status(400).json({ error: 'Missing saveId parameter' });
      }

      const { error } = await supabase
        .from('saves')
        .delete()
        .eq('id', saveId)
        .eq('user_id', userId);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
