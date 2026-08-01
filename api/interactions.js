import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

  // --- LIKE ---
  if (req.method === 'POST' && action === 'like') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('id, is_published')
      .eq('id', promptId)
      .single();

    if (!prompt || !prompt.is_published) {
      return res.status(404).json({ error: 'Prompt not found or unpublished' });
    }

    const { data: existing } = await supabaseAdmin
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Already liked this prompt' });
    }

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

    await supabaseAdmin
      .from('prompts')
      .update({ like_count: prompt.like_count + 1 })
      .eq('id', promptId);

    await supabaseAdmin
      .from('user_activity')
      .insert({
        user_id: userId,
        prompt_id: promptId,
        action_type: 'like'
      });

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

  // --- UNLIKE ---
  if (req.method === 'DELETE' && action === 'unlike') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    const { data: existing } = await supabaseAdmin
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'You have not liked this prompt' });
    }

    const { error } = await supabaseAdmin
      .from('likes')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabaseAdmin
      .from('prompts')
      .update({ like_count: prompt.like_count - 1 })
      .eq('id', promptId);

    await supabaseAdmin
      .from('user_activity')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .eq('action_type', 'like');

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

  // --- SAVE ---
  if (req.method === 'POST' && action === 'save') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('id, is_published')
      .eq('id', promptId)
      .single();

    if (!prompt || !prompt.is_published) {
      return res.status(404).json({ error: 'Prompt not found or unpublished' });
    }

    const { data: existing } = await supabaseAdmin
      .from('saves')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Already saved this prompt' });
    }

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

    await supabaseAdmin
      .from('prompts')
      .update({ save_count: prompt.save_count + 1 })
      .eq('id', promptId);

    await supabaseAdmin
      .from('user_activity')
      .insert({
        user_id: userId,
        prompt_id: promptId,
        action_type: 'save'
      });

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

  // --- UNSAVE ---
  if (req.method === 'DELETE' && action === 'unsave') {
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    const { data: existing } = await supabaseAdmin
      .from('saves')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'You have not saved this prompt' });
    }

    const { error } = await supabaseAdmin
      .from('saves')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabaseAdmin
      .from('prompts')
      .update({ save_count: prompt.save_count - 1 })
      .eq('id', promptId);

    await supabaseAdmin
      .from('user_activity')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .eq('action_type', 'save');

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

  // --- STATUS ---
  if (req.method === 'GET' && action === 'status') {
    const { promptId } = req.query;

    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    const { data: liked } = await supabaseAdmin
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

    const { data: saved } = await supabaseAdmin
      .from('saves')
      .select('id')
      .eq('user_id', userId)
      .eq('prompt_id', promptId)
      .maybeSingle();

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

  // --- LIKED PROMPTS (FIXED - NO FOREIGN KEY JOIN) ---
  if (req.method === 'GET' && action === 'liked-prompts') {
    const { targetUserId, limit = 20, offset = 0 } = req.query;
    const id = targetUserId || userId;

    // Force numbers to prevent NaN crash
    const offsetNum = Number(offset) || 0;
    const limitNum = Number(limit) || 20;

    try {
      // First, get the liked prompt IDs
      const { data: likes, error: likesError, count } = await supabaseAdmin
        .from('likes')
        .select('prompt_id', { count: 'exact' })
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .range(offsetNum, offsetNum + limitNum - 1);

      if (likesError) {
        return res.status(500).json({ error: likesError.message });
      }

      if (!likes || likes.length === 0) {
        return res.status(200).json({
          prompts: [],
          total: count || 0,
          hasMore: false
        });
      }

      const promptIds = likes.map(item => item.prompt_id);

      // Then fetch the prompt details separately
      const { data: prompts, error: promptsError } = await supabaseAdmin
        .from('prompts')
        .select('id, slug, title, image_main, description, like_count, save_count, created_at')
        .in('id', promptIds)
        .order('created_at', { ascending: false });

      if (promptsError) {
        return res.status(500).json({ error: promptsError.message });
      }

      return res.status(200).json({
        prompts: prompts || [],
        total: count || 0,
        hasMore: (offsetNum + limitNum) < (count || 0)
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // --- SAVED PROMPTS (FIXED - NO FOREIGN KEY JOIN) ---
  if (req.method === 'GET' && action === 'saved-prompts') {
    const { targetUserId, limit = 20, offset = 0 } = req.query;
    const id = targetUserId || userId;

    // Force numbers to prevent NaN crash
    const offsetNum = Number(offset) || 0;
    const limitNum = Number(limit) || 20;

    try {
      // First, get the saved prompt IDs
      const { data: saves, error: savesError, count } = await supabaseAdmin
        .from('saves')
        .select('prompt_id', { count: 'exact' })
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .range(offsetNum, offsetNum + limitNum - 1);

      if (savesError) {
        return res.status(500).json({ error: savesError.message });
      }

      if (!saves || saves.length === 0) {
        return res.status(200).json({
          prompts: [],
          total: count || 0,
          hasMore: false
        });
      }

      const promptIds = saves.map(item => item.prompt_id);

      // Then fetch the prompt details separately
      const { data: prompts, error: promptsError } = await supabaseAdmin
        .from('prompts')
        .select('id, slug, title, image_main, description, like_count, save_count, created_at')
        .in('id', promptIds)
        .order('created_at', { ascending: false });

      if (promptsError) {
        return res.status(500).json({ error: promptsError.message });
      }

      return res.status(200).json({
        prompts: prompts || [],
        total: count || 0,
        hasMore: (offsetNum + limitNum) < (count || 0)
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
