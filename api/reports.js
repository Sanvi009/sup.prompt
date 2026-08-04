import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;

  if (action === 'submit') {
    const { targetUserId, targetPromptId, reason, details } = req.body;

    if (!targetUserId && !targetPromptId) {
      return res.status(400).json({ 
        error: 'Either targetUserId or targetPromptId is required' 
      });
    }

    if (targetUserId && targetPromptId) {
      return res.status(400).json({ 
        error: 'Report cannot target both a user and a prompt simultaneously' 
      });
    }

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: 'Reason is required' });
    }

    let reporterId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        reporterId = decoded.id;
      } catch (err) {
        reporterId = null;
      }
    }

    if (targetUserId) {
      const { data: user } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', targetUserId)
        .single();

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (reporterId && reporterId === targetUserId) {
        return res.status(400).json({ error: 'You cannot report yourself' });
      }
    }

    if (targetPromptId) {
      const { data: prompt } = await supabaseAdmin
        .from('prompts')
        .select('id')
        .eq('id', targetPromptId)
        .single();

      if (!prompt) {
        return res.status(404).json({ error: 'Prompt not found' });
      }
    }

    const { data: report, error } = await supabaseAdmin
      .from('reports')
      .insert({
        reporter_id: reporterId,
        reported_user_id: targetUserId || null,
        reported_prompt_id: targetPromptId || null,
        reason: reason.trim(),
        details: details ? details.trim() : null,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({
      success: true,
      message: 'Report submitted successfully',
      report_id: report.id
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}