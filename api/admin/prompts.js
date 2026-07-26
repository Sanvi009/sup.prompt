// /api/admin/prompts.js
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  // Verify admin token
  const adminToken = req.cookies?.admin_token;
  if (!adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { method, query, body } = req;

  try {
    // ========== GET: List all prompts ==========
    if (method === 'GET') {
      const { page = 0, limit = 20, filter } = query;

      let queryBuilder = supabase
        .from('prompts')
        .select(`
          id,
          slug,
          title,
          description,
          image_main,
          is_published,
          is_boosted,
          created_at,
          likes:likes(count),
          saves:saves(count),
          comments:comments(count)
        `);

      if (filter === 'published') {
        queryBuilder = queryBuilder.eq('is_published', true);
      } else if (filter === 'unpublished') {
        queryBuilder = queryBuilder.eq('is_published', false);
      } else if (filter === 'boosted') {
        queryBuilder = queryBuilder.eq('is_boosted', true);
      } else {
        queryBuilder = queryBuilder.order('created_at', { ascending: false });
      }

      queryBuilder = queryBuilder
        .range(page * limit, (page + 1) * limit - 1);

      const { data: prompts, error } = await queryBuilder;

      if (error) throw error;

      return res.status(200).json({
        prompts: prompts || [],
        page: parseInt(page),
        limit: parseInt(limit)
      });
    }

    // ========== POST: Create new prompt ==========
    if (method === 'POST') {
      const { title, description, prompt_text, image_main, image_optional, category_ids } = body;

      if (!title || !prompt_text || !image_main) {
        return res.status(400).json({ error: 'Title, prompt text, and main image required' });
      }

      // Generate slug
      let slug = title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Check if slug exists
      const { data: existing } = await supabase
        .from('prompts')
        .select('slug')
        .eq('slug', slug)
        .single();

      if (existing) {
        slug = `${slug}-${Date.now()}`;
      }

      const { data: newPrompt, error } = await supabase
        .from('prompts')
        .insert({
          slug,
          title,
          description: description || '',
          prompt_text,
          image_main,
          image_optional: image_optional || null,
          category_ids: category_ids || [],
          is_published: true,
          is_boosted: false
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ success: true, prompt: newPrompt });
    }

    // ========== PUT: Update prompt ==========
    if (method === 'PUT') {
      const { promptId, updates } = body;

      if (!promptId || !updates) {
        return res.status(400).json({ error: 'Prompt ID and updates required' });
      }

      // Handle image deletion: if new image is provided, delete old one
      if (updates.image_main) {
        // Get old image to delete
        const { data: oldPrompt } = await supabase
          .from('prompts')
          .select('image_main')
          .eq('id', promptId)
          .single();

        if (oldPrompt?.image_main) {
          // Extract filename from URL
          const oldPath = oldPrompt.image_main.split('/').pop();
          if (oldPath) {
            await supabase.storage
              .from('prompt_images')
              .remove([oldPath]);
          }
        }
      }

      const { error } = await supabase
        .from('prompts')
        .update({
          ...updates,
          updated_at: new Date()
        })
        .eq('id', promptId);

      if (error) throw error;

      return res.status(200).json({ success: true, message: 'Prompt updated' });
    }

    // ========== DELETE: Delete prompt ==========
    if (method === 'DELETE') {
      const { promptId } = query;

      if (!promptId) {
        return res.status(400).json({ error: 'Prompt ID required' });
      }

      // Get images to delete
      const { data: prompt } = await supabase
        .from('prompts')
        .select('image_main, image_optional')
        .eq('id', promptId)
        .single();

      // Delete images from storage
      if (prompt) {
        const files = [];
        if (prompt.image_main) {
          const mainPath = prompt.image_main.split('/').pop();
          if (mainPath) files.push(mainPath);
        }
        if (prompt.image_optional) {
          const optPath = prompt.image_optional.split('/').pop();
          if (optPath) files.push(optPath);
        }
        if (files.length > 0) {
          await supabase.storage
            .from('prompt_images')
            .remove(files);
        }
      }

      // Delete prompt (cascade will delete likes, saves, comments)
      const { error } = await supabase
        .from('prompts')
        .delete()
        .eq('id', promptId);

      if (error) throw error;

      return res.status(200).json({ success: true, message: 'Prompt deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Prompt management error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
