import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // 1. Total users
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    // 2. Total prompts
    const { count: totalPrompts } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('is_published', true);

    // 3. Total likes
    const { count: totalLikes } = await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true });

    // 4. Total saves
    const { count: totalSaves } = await supabase
      .from('saves')
      .select('*', { count: 'exact', head: true });

    // 5. Most liked prompt (simplified)
    const { data: mostLikedPrompt } = await supabase
      .from('prompts')
      .select('id, prompt_id, title, image_main')
      .eq('is_published', true)
      .limit(1);

    // 6. Most saved prompt (simplified)
    const { data: mostSavedPrompt } = await supabase
      .from('prompts')
      .select('id, prompt_id, title, image_main')
      .eq('is_published', true)
      .limit(1);

    // Get like/save counts separately
    let mostLiked = null;
    let mostSaved = null;

    if (mostLikedPrompt?.length > 0) {
      const { count: likeCount } = await supabase
        .from('likes')
        .select('*', { count: 'exact', head: true })
        .eq('prompt_id', mostLikedPrompt[0].id);
      
      mostLiked = {
        ...mostLikedPrompt[0],
        likes: [{ count: likeCount || 0 }]
      };
    }

    if (mostSavedPrompt?.length > 0) {
      const { count: saveCount } = await supabase
        .from('saves')
        .select('*', { count: 'exact', head: true })
        .eq('prompt_id', mostSavedPrompt[0].id);
      
      mostSaved = {
        ...mostSavedPrompt[0],
        saves: [{ count: saveCount || 0 }]
      };
    }

    // 7. New users today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { count: newUsersToday } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // 8. New prompts today
    const { count: newPromptsToday } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    return res.status(200).json({
      totalUsers: totalUsers || 0,
      totalPrompts: totalPrompts || 0,
      totalLikes: totalLikes || 0,
      totalSaves: totalSaves || 0,
      mostLikedPrompt: mostLiked,
      mostSavedPrompt: mostSaved,
      newUsersToday: newUsersToday || 0,
      newPromptsToday: newPromptsToday || 0,
      engagementRatio: totalPrompts > 0 
        ? ((totalLikes + totalSaves) / totalPrompts).toFixed(1)
        : 0
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
}
