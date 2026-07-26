import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Admin auth check
  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    const { filter = 'newest', search = '', limit = 50, offset = 0 } = req.query;

    let queryBuilder = supabase
      .from('users')
      .select(`
        id,
        username,
        nickname,
        bio,
        profile_pic,
        role,
        is_banned,
        ban_note,
        created_at,
        premium_since
      `, { count: 'exact' });

    if (search) {
      queryBuilder = queryBuilder.or(`username.ilike.%${search}%,nickname.ilike.%${search}%`);
    }

    switch (filter) {
      case 'newest': queryBuilder = queryBuilder.order('created_at', { ascending: false }); break;
      case 'oldest': queryBuilder = queryBuilder.order('created_at', { ascending: true }); break;
      case 'banned': queryBuilder = queryBuilder.eq('is_banned', true); break;
      case 'premium': queryBuilder = queryBuilder.eq('role', 'premium'); break;
      default: queryBuilder = queryBuilder.order('created_at', { ascending: false });
    }

    queryBuilder = queryBuilder.range(offset, offset + limit - 1);

    const { data: users, count, error } = await queryBuilder;
    if (error) throw error;

    const usersWithStats = await Promise.all(users.map(async (user) => {
      const [followers, following, totalLikes, totalSaves, totalComments] = await Promise.all([
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user.id),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', user.id),
        supabase.from('likes').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('saves').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('comments').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
      ]);

      return {
        ...user,
        followers: followers.count || 0,
        following: following.count || 0,
        totalLikes: totalLikes.count || 0,
        totalSaves: totalSaves.count || 0,
        totalComments: totalComments.count || 0
      };
    }));

    return res.status(200).json({
      users: usersWithStats,
      total: count || 0,
      hasMore: (offset + limit) < count
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
