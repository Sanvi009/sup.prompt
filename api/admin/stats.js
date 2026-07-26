// /api/admin/stats.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin token
  const adminToken = req.cookies?.admin_token;
  if (!adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // 1. Total Users
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    // 2. Total Prompts
    const { count: totalPrompts } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true });

    // 3. Total Likes (entire site)
    const { count: totalLikes } = await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true });

    // 4. Total Saves (entire site)
    const { count: totalSaves } = await supabase
      .from('saves')
      .select('*', { count: 'exact', head: true });

    // 5. Total Comments
    const { count: totalComments } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true });

    // 6. Most Liked Prompt
    const { data: mostLikedPrompt } = await supabase
      .from('prompts')
      .select(`
        id,
        title,
        image_main,
        likes:likes(count)
      `)
      .eq('is_published', true)
      .order('likes', { ascending: false })
      .limit(1);

    // 7. Most Saved Prompt
    const { data: mostSavedPrompt } = await supabase
      .from('prompts')
      .select(`
        id,
        title,
        image_main,
        saves:saves(count)
      `)
      .eq('is_published', true)
      .order('saves', { ascending: false })
      .limit(1);

    // 8. Most Commented Prompt
    const { data: mostCommentedPrompt } = await supabase
      .from('prompts')
      .select(`
        id,
        title,
        image_main,
        comments:comments(count)
      `)
      .eq('is_published', true)
      .order('comments', { ascending: false })
      .limit(1);

    // 9. Recent Activity (last 10 prompts)
    const { data: recentPrompts } = await supabase
      .from('prompts')
      .select('id, title, created_at')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(10);

    // 10. New Users (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count: newUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo.toISOString());

    return res.status(200).json({
      totalUsers: totalUsers || 0,
      totalPrompts: totalPrompts || 0,
      totalLikes: totalLikes || 0,
      totalSaves: totalSaves || 0,
      totalComments: totalComments || 0,
      newUsersLast7Days: newUsers || 0,
      mostLikedPrompt: mostLikedPrompt?.[0] || null,
      mostSavedPrompt: mostSavedPrompt?.[0] || null,
      mostCommentedPrompt: mostCommentedPrompt?.[0] || null,
      recentPrompts: recentPrompts || []
    });

  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}
