// /api/interactions.js
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { action } = req.query;
  const { promptId } = req.body;

  // ============================================
  // LIKE / UNLIKE
  // ============================================

  // --- LIKE A PROMPT ---
  if (req.method === 'POST' && action === 'like') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    // Check if prompt exists and is published
    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('id, is_published')
      .eq('id', promptId)
      .single();

    if (!prompt || !prompt.is_published) {
      return res.status(404).json({ error: 'Prompt not found or unpublished' });
    }

    // Check if already liked
    const { data: existing } = await supabaseAdmin
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Already liked this prompt' });
    }

    // Insert like
    const { data, error } = await supabaseAdmin
      .from('likes')
      .insert({
        user_id: userId,
        prompt_id: promptId
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Increment like_count on prompt
    await supabaseAdmin
      .from('prompts')
      .update({ like_count: prompt.like_count + 1 })
      .eq('id', promptId);

    // Log activity for feed algorithm
    await supabaseAdmin
      .from('user_activity')
      .insert({
        user_id: userId,
        prompt_id: promptId,
        action_type: 'like'
      });

    // Get updated like count
    const { count: likes } = await supabaseAdmin
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', promptId);

    return res.status(201).json({
      success: true,
      action: 'liked',
      like_count: likes || 0
    });
  }

  // --- UNLIKE A PROMPT ---
  if (req.method === 'DELETE' && action === 'unlike') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    // Check if liked
    const { data: existing } = await supabaseAdmin
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'You have not liked this prompt' });
    }

    // Delete like
    const { error } = await supabaseAdmin
      .from('likes')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Decrement like_count on prompt
    await supabaseAdmin
      .from('prompts')
      .update({ like_count: prompt.like_count - 1 })
      .eq('id', promptId);

    // Delete activity
    await supabaseAdmin
      .from('user_activity')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .eq('action_type', 'like');

    // Get updated like count
    const { count: likes } = await supabaseAdmin
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', promptId);

    return res.status(200).json({
      success: true,
      action: 'unliked',
      like_count: likes || 0
    });
  }

  // ============================================
  // SAVE / UNSAVE
  // ============================================

  // --- SAVE A PROMPT ---
  if (req.method === 'POST' && action === 'save') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    // Check if prompt exists and is published
    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('id, is_published')
      .eq('id', promptId)
      .single();

    if (!prompt || !prompt.is_published) {
      return res.status(404).json({ error: 'Prompt not found or unpublished' });
    }

    // Check if already saved
    const { data: existing } = await supabaseAdmin
      .from('saves')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Already saved this prompt' });
    }

    // Insert save
    const { data, error } = await supabaseAdmin
      .from('saves')
      .insert({
        user_id: userId,
        prompt_id: promptId
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Increment save_count on prompt
    await supabaseAdmin
      .from('prompts')
      .update({ save_count: prompt.save_count + 1 })
      .eq('id', promptId);

    // Log activity for feed algorithm
    await supabaseAdmin
      .from('user_activity')
      .insert({
        user_id: userId,
        prompt_id: promptId,
        action_type: 'save'
      });

    // Get updated save count
    const { count: saves } = await supabaseAdmin
      .from('saves')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', promptId);

    return res.status(201).json({
      success: true,
      action: 'saved',
      save_count: saves || 0
    });
  }

  // --- UNSAVE A PROMPT ---
  if (req.method === 'DELETE' && action === 'unsave') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    // Check if saved
    const { data: existing } = await supabaseAdmin
      .from('saves')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'You have not saved this prompt' });
    }

    // Delete save
    const { error } = await supabaseAdmin
      .from('saves')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Decrement save_count on prompt
    await supabaseAdmin
      .from('prompts')
      .update({ save_count: prompt.save_count - 1 })
      .eq('id', promptId);

    // Delete activity
    await supabaseAdmin
      .from('user_activity')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .eq('action_type', 'save');

    // Get updated save count
    const { count: saves } = await supabaseAdmin
      .from('saves')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', promptId);

    return res.status(200).json({
      success: true,
      action: 'unsaved',
      save_count: saves || 0
    });
  }

  // ============================================
  // CHECK STATUS (liked/saved)
  // ============================================

  // --- GET INTERACTION STATUS FOR A PROMPT ---
  if (req.method === 'GET' && action === 'status') {
    const { promptId } = req.query;

    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    // Check if liked
    const { data: liked } = await supabaseAdmin
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    // Check if saved
    const { data: saved } = await supabaseAdmin
      .from('saves')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    // Get counts
    const { count: likes } = await supabaseAdmin
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', promptId);

    const { count: saves } = await supabaseAdmin
      .from('saves')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', promptId);

    return res.status(200).json({
      liked: !!liked,
      saved: !!saved,
      like_count: likes || 0,
      save_count: saves || 0
    });
  }

  // --- GET ALL LIKED PROMPTS FOR A USER ---
  if (req.method === 'GET' && action === 'liked-prompts') {
    const { targetUserId, limit = 20, offset = 0 } = req.query;
    const id = targetUserId || userId;

    const { data: likedPrompts, error, count } = await supabaseAdmin
      .from('likes')
      .select(`
        prompt_id,
        created_at,
        prompts:prompt_id (
          id,
          slug,
          title,
          image_main,
          description,
          like_count,
          save_count,
          created_at
        )
      `, { count: 'exact' })
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      prompts: likedPrompts.map(item => item.prompts),
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  // --- GET ALL SAVED PROMPTS FOR A USER ---
  if (req.method === 'GET' && action === 'saved-prompts') {
    const { targetUserId, limit = 20, offset = 0 } = req.query;
    const id = targetUserId || userId;

    const { data: savedPrompts, error, count } = await supabaseAdmin
      .from('saves')
      .select(`
        prompt_id,
        created_at,
        prompts:prompt_id (
          id,
          slug,
          title,
          image_main,
          description,
          like_count,
          save_count,
          created_at
        )
      `, { count: 'exact' })
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      prompts: savedPrompts.map(item => item.prompts),
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
