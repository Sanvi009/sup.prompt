import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Admin auth check
  const cookies = req.headers.cookie || '';
  if (!cookies.includes('admin_auth=true')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const url = req.url;
  const method = req.method;
  const path = url.split('?')[0];
  const parts = path.split('/').filter(p => p !== '');
  
  // parts: ['api', 'admin', 'prompts', promptId, action]

  // ===== GET /api/admin/prompts =====
  if (method === 'GET' && parts.length === 3) {
    try {
      const { filter = 'all', search = '', limit = 50, offset = 0 } = req.query;

      let query = supabase
        .from('prompts')
        .select(`
          id,
          prompt_id,
          slug,
          title,
          description,
          prompt_text,
          image_main,
          image_optional,
          is_published,
          is_boosted,
          created_at,
          updated_at
        `, { count: 'exact' });

      // Search
      if (search) {
        query = query.or(`title.ilike.%${search}%,prompt_id.ilike.%${search}%`);
      }

      // Filter
      if (filter === 'published') query = query.eq('is_published', true);
      else if (filter === 'unpublished') query = query.eq('is_published', false);
      else if (filter === 'boosted') query = query.eq('is_boosted', true);

      query = query.order('created_at', { ascending: false });
      query = query.range(offset, offset + limit - 1);

      const { data: prompts, count, error } = await query;
      if (error) throw error;

      // Attach like, save, comment counts
      const promptsWithStats = await Promise.all(prompts.map(async (p) => {
        const [likes, saves, comments] = await Promise.all([
          supabase.from('likes').select('*', { count: 'exact', head: true }).eq('prompt_id', p.id),
          supabase.from('saves').select('*', { count: 'exact', head: true }).eq('prompt_id', p.id),
          supabase.from('comments').select('*', { count: 'exact', head: true }).eq('prompt_id', p.id)
        ]);
        return {
          ...p,
          like_count: likes.count || 0,
          save_count: saves.count || 0,
          comment_count: comments.count || 0
        };
      }));

      return res.status(200).json({
        prompts: promptsWithStats,
        total: count || 0,
        hasMore: (offset + limit) < count
      });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }


  // ===== POST /api/admin/prompts =====
if (method === 'POST' && parts.length === 3) {
  try {
    const { title, description, prompt_text, category_ids, image_main, image_optional } = req.body;

    // Insert the prompt (trigger auto-generates prompt_id)
    const { data: newPrompt, error } = await supabase
      .from('prompts')
      .insert({
        title,
        description,
        prompt_text,
        image_main: image_main || '',
        image_optional: image_optional || '',
        is_published: true,
        is_boosted: false,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      })
      .select()
      .single();

    if (error) throw error;

    // Link categories
    if (category_ids && category_ids.length > 0) {
      const categoryRows = category_ids.map(catId => ({
        prompt_id: newPrompt.id,
        category_id: catId
      }));
      const { error: catError } = await supabase
        .from('prompt_categories')
        .insert(categoryRows);
      if (catError) throw catError;
    }

    return res.status(200).json(newPrompt);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

  

  // ===== PATCH /api/admin/prompts/:promptId =====
  if (method === 'PATCH' && parts.length === 4) {
    const promptId = parts[3];
    try {
      const { title, description, prompt_text, image_main, image_optional } = req.body;

      const updates = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (prompt_text !== undefined) updates.prompt_text = prompt_text;
      if (image_main !== undefined) updates.image_main = image_main;
      if (image_optional !== undefined) updates.image_optional = image_optional;
      updates.updated_at = new Date();

      const { error } = await supabase
        .from('prompts')
        .update(updates)
        .eq('id', promptId);

      if (error) throw error;
      return res.status(200).json({ success: true });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== DELETE /api/admin/prompts/:promptId =====
  if (method === 'DELETE' && parts.length === 4) {
    const promptId = parts[3];
    try {
      // Get images to delete from storage
      const { data: prompt } = await supabase
        .from('prompts')
        .select('image_main, image_optional')
        .eq('id', promptId)
        .single();

      // Delete prompt (cascades to likes, saves, comments, views, reports)
      const { error } = await supabase
        .from('prompts')
        .delete()
        .eq('id', promptId);

      if (error) throw error;

      // Delete images from storage
      const toDelete = [];
      if (prompt?.image_main) {
        const mainPath = prompt.image_main.split('/prompt_images/')[1];
        if (mainPath) toDelete.push(mainPath);
      }
      if (prompt?.image_optional) {
        const optPath = prompt.image_optional.split('/prompt_images/')[1];
        if (optPath) toDelete.push(optPath);
      }
      if (toDelete.length > 0) {
        await supabase.storage.from('prompt_images').remove(toDelete);
      }

      return res.status(200).json({ success: true });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== PATCH /api/admin/prompts/:promptId/publish =====
  if (method === 'PATCH' && parts.length === 5 && parts[4] === 'publish') {
    const promptId = parts[3];
    try {
      const { is_published } = req.body;
      const { error } = await supabase
        .from('prompts')
        .update({ is_published })
        .eq('id', promptId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== PATCH /api/admin/prompts/:promptId/boost =====
  if (method === 'PATCH' && parts.length === 5 && parts[4] === 'boost') {
    const promptId = parts[3];
    try {
      const { is_boosted } = req.body;
      const { error } = await supabase
        .from('prompts')
        .update({ is_boosted })
        .eq('id', promptId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== GET /api/admin/prompts/:promptId/likes =====
  if (method === 'GET' && parts.length === 5 && parts[4] === 'likes') {
    const promptId = parts[3];
    try {
      const { data: likes, error } = await supabase
        .from('likes')
        .select(`
          id,
          created_at,
          users:user_id (
            id,
            username,
            nickname,
            profile_pic
          )
        `)
        .eq('prompt_id', promptId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ likes });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ===== GET /api/admin/prompts/:promptId/saves =====
  if (method === 'GET' && parts.length === 5 && parts[4] === 'saves') {
    const promptId = parts[3];
    try {
      const { data: saves, error } = await supabase
        .from('saves')
        .select(`
          id,
          created_at,
          users:user_id (
            id,
            username,
            nickname,
            profile_pic
          )
        `)
        .eq('prompt_id', promptId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ saves });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(404).json({ error: 'Route not found' });
}
