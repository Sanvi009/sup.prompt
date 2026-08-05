import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.is_owner) {
      return res.status(403).json({ error: 'Forbidden — Admin access required' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const adminId = decoded.id;
  const { action } = req.query;

  if (req.method === 'GET' && action === 'list') {
    const { status = 'pending', type, limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('reports')
      .select(`
        id,
        reporter_id,
        reported_user_id,
        reported_prompt_id,
        reason,
        details,
        status,
        admin_note,
        created_at,
        resolved_at,
        reporter:reporter_id (
          id,
          username,
          display_name,
          avatar_url
        ),
        reported_user:reported_user_id (
          id,
          username,
          display_name,
          avatar_url
        ),
        reported_prompt:reported_prompt_id (
          id,
          slug,
          title,
          image_main
        )
      `, { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    if (type === 'user') {
      query = query.not('reported_user_id', 'is', null);
    } else if (type === 'prompt') {
      query = query.not('reported_prompt_id', 'is', null);
    }

    query = query.order('created_at', { ascending: false });

    const { data: reports, error, count } = await query
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      reports: reports || [],
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  if (req.method === 'GET' && action === 'get') {
    const { reportId } = req.query;

    if (!reportId) {
      return res.status(400).json({ error: 'Report ID required' });
    }

    const { data: report, error } = await supabaseAdmin
      .from('reports')
      .select(`
        id,
        reporter_id,
        reported_user_id,
        reported_prompt_id,
        reason,
        details,
        status,
        admin_note,
        created_at,
        resolved_at,
        reporter:reporter_id (
          id,
          username,
          display_name,
          avatar_url
        ),
        reported_user:reported_user_id (
          id,
          username,
          display_name,
          avatar_url,
          is_banned,
          ban_note
        ),
        reported_prompt:reported_prompt_id (
          id,
          slug,
          title,
          description,
          image_main,
          is_published,
          is_boosted
        )
      `)
      .eq('id', reportId)
      .single();

    if (error || !report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    return res.status(200).json({ report });
  }

  if (req.method === 'PUT' && action === 'resolve') {
    const { reportId, adminNote } = req.body;

    if (!reportId) {
      return res.status(400).json({ error: 'Report ID required' });
    }

    const { data: report } = await supabaseAdmin
      .from('reports')
      .select('id, status')
      .eq('id', reportId)
      .single();

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (report.status === 'resolved') {
      return res.status(409).json({ error: 'Report is already resolved' });
    }

    const { data, error } = await supabaseAdmin
      .from('reports')
      .update({
        status: 'resolved',
        admin_note: adminNote || null,
        resolved_at: new Date().toISOString()
      })
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Report resolved',
      report: data
    });
  }

  if (req.method === 'PUT' && action === 'dismiss') {
    const { reportId, adminNote } = req.body;

    if (!reportId) {
      return res.status(400).json({ error: 'Report ID required' });
    }

    const { data: report } = await supabaseAdmin
      .from('reports')
      .select('id, status')
      .eq('id', reportId)
      .single();

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (report.status === 'dismissed') {
      return res.status(409).json({ error: 'Report is already dismissed' });
    }

    const { data, error } = await supabaseAdmin
      .from('reports')
      .update({
        status: 'dismissed',
        admin_note: adminNote || null,
        resolved_at: new Date().toISOString()
      })
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Report dismissed',
      report: data
    });
  }

  if (req.method === 'DELETE' && action === 'delete') {
    const { reportId } = req.query;

    if (!reportId) {
      return res.status(400).json({ error: 'Report ID required' });
    }

    const { data: report } = await supabaseAdmin
      .from('reports')
      .select('id')
      .eq('id', reportId)
      .single();

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const { error } = await supabaseAdmin
      .from('reports')
      .delete()
      .eq('id', reportId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Report deleted permanently'
    });
  }

  if (req.method === 'GET' && action === 'stats') {
    const { count: total } = await supabaseAdmin
      .from('reports')
      .select('*', { count: 'exact', head: true });

    const { count: pending } = await supabaseAdmin
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: resolved } = await supabaseAdmin
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'resolved');

    const { count: dismissed } = await supabaseAdmin
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'dismissed');

    const { count: userReports } = await supabaseAdmin
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .not('reported_user_id', 'is', null);

    const { count: promptReports } = await supabaseAdmin
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .not('reported_prompt_id', 'is', null);

    return res.status(200).json({
      stats: {
        total: total || 0,
        pending: pending || 0,
        resolved: resolved || 0,
        dismissed: dismissed || 0,
        userReports: userReports || 0,
        promptReports: promptReports || 0
      }
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}