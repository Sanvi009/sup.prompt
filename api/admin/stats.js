// /api/admin/stats.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // === DEBUG: Log all cookies to see what's coming ===
  console.log('Headers:', req.headers);
  console.log('Cookies raw:', req.headers.cookie);

  // === MANUAL COOKIE PARSER ===
  function getCookie(name) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader.split(';').reduce((acc, pair) => {
      const [key, val] = pair.trim().split('=');
      if (key && val) acc[key] = decodeURIComponent(val);
      return acc;
    }, {});
    return cookies[name];
  }

  const adminToken = getCookie('admin_token');

  console.log('Admin token found:', adminToken ? 'YES' : 'NO');

  if (!adminToken) {
    return res.status(401).json({ error: 'Unauthorized - No token' });
  }

  // Check if Supabase env vars exist
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('Missing Supabase environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // Verify admin session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('user_id, users!inner(is_owner)')
      .eq('token', adminToken)
      .single();

    if (sessionError || !session) {
      console.error('Session error:', sessionError);
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Check if user is owner
    if (!session.users?.is_owner) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // ===== SIMPLE STATS =====
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    const { count: totalPrompts } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true });

    const { count: totalLikes } = await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true });

    const { count: totalSaves } = await supabase
      .from('saves')
      .select('*', { count: 'exact', head: true });

    const { count: totalComments } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true });

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
      mostLikedPrompt: null,
      mostSavedPrompt: null,
      mostCommentedPrompt: null,
      recentPrompts: []
    });

  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch stats',
      details: error.message 
    });
  }
}
