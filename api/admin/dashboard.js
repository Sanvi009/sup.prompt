import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check admin auth via cookie
  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // Get all stats in parallel
    const [
      totalUsers,
      totalPrompts,
      totalLikes,
      totalSaves,
      mostLikedPrompt,
      mostSavedPrompt,
      newUsersToday,
      newPromptsToday,
      activeUsers7Days
    ] = await Promise.all([
      // Total users
      supabase.from('users').select('*', { count: 'exact', head: true }),
      
      // Total published prompts
      supabase.from('prompts').select('*', { count: 'exact', head: true }).eq('is_published', true),
      
      // Total likes
      supabase.from('likes').select('*', { count: 'exact', head: true }),
      
      // Total saves
      supabase.from('saves').select('*', { count: 'exact', head: true }),
      
      // Most liked prompt
      supabase
        .from('prompts')
        .select(`
          id,
          prompt_id,
          title,
          image_main,
          likes:likes(count)
        `)
        .eq('is_published', true)
        .order('likes', { ascending: false, foreignTable: 'likes' })
        .limit(1),
      
      // Most saved prompt
      supabase
        .from('prompts')
        .select(`
          id,
          prompt_id,
          title,
          image_main,
          saves:saves(count)
        `)
        .eq('is_published', true)
        .order('saves', { ascending: false, foreignTable: 'saves' })
        .limit(1),
      
      // New users today
      supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
      
      // New prompts today
      supabase
        .from('prompts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
      
      // Active users in last 7 days (users who liked/saved/commented)
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .or(`
          id.in.(select user_id from likes where created_at >= now() - interval '7 days'),
          id.in.(select user_id from saves where created_at >= now() - interval '7 days'),
          id.in.(select user_id from comments where created_at >= now() - interval '7 days')
        `)
    ]);

    // Check for errors
    if (totalUsers.error) throw totalUsers.error;
    if (totalPrompts.error) throw totalPrompts.error;
    if (totalLikes.error) throw totalLikes.error;
    if (totalSaves.error) throw totalSaves.error;
    if (mostLikedPrompt.error) throw mostLikedPrompt.error;
    if (mostSavedPrompt.error) throw mostSavedPrompt.error;
    if (newUsersToday.error) throw newUsersToday.error;
    if (newPromptsToday.error) throw newPromptsToday.error;
    if (activeUsers7Days.error) throw activeUsers7Days.error;

    // Format response
    const dashboardData = {
      totalUsers: totalUsers.count || 0,
      totalPrompts: totalPrompts.count || 0,
      totalLikes: totalLikes.count || 0,
      totalSaves: totalSaves.count || 0,
      mostLikedPrompt: mostLikedPrompt.data?.[0] || null,
      mostSavedPrompt: mostSavedPrompt.data?.[0] || null,
      newUsersToday: newUsersToday.count || 0,
      newPromptsToday: newPromptsToday.count || 0,
      activeUsers7Days: activeUsers7Days.count || 0,
      // Calculate engagement ratio
      engagementRatio: totalPrompts.count > 0 
        ? ((totalLikes.count + totalSaves.count) / totalPrompts.count).toFixed(1)
        : 0
    };

    return res.status(200).json(dashboardData);

  } catch (error) {
    console.error('Dashboard API error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch dashboard data',
      details: error.message 
    });
  }
}
