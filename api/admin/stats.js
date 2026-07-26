// /api/admin/stats.js
import { createClient } from '@supabase/supabase-js';

// Simple cookie parser (no external dependency needed)
function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(pair => {
        const [key, val] = pair.trim().split('=');
        if (key && val) cookies[key] = decodeURIComponent(val);
    });
    return cookies;
}

export default async function handler(req, res) {
    // Only allow GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse cookies manually (no npm package needed)
    const cookies = parseCookies(req.headers.cookie || '');
    const adminToken = cookies.admin_token;

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
            return res.status(401).json({ error: 'Invalid session' });
        }

        // Check if user is owner
        if (!session.users?.is_owner) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        // ===== SIMPLE STATS =====
        
        // Total Users
        const { count: totalUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        // Total Prompts
        const { count: totalPrompts } = await supabase
            .from('prompts')
            .select('*', { count: 'exact', head: true });

        // Total Likes
        const { count: totalLikes } = await supabase
            .from('likes')
            .select('*', { count: 'exact', head: true });

        // Total Saves
        const { count: totalSaves } = await supabase
            .from('saves')
            .select('*', { count: 'exact', head: true });

        // Total Comments
        const { count: totalComments } = await supabase
            .from('comments')
            .select('*', { count: 'exact', head: true });

        // New Users (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { count: newUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', sevenDaysAgo.toISOString());

        // Return basic stats (no complex joins to avoid errors)
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
