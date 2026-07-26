import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    const userId = req.query.id;

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
