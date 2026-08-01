import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  if (req.method === 'GET' && action === 'by-slug') {
    const { slug } = req.query;

    if (!slug) {
      return res.status(400).json({ error: 'Slug required' });
    }

    const { data: prompt, error } = await supabaseAdmin
      .from('prompts')
      .select('*')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();

    if (error || !prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    supabaseAdmin
      .from('prompts')
      .update({ view_count: prompt.view_count + 1 })
      .eq('id', prompt.id);

    const { count: likes } = await supabaseAdmin
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', prompt.id);

    const { count: saves } = await supabaseAdmin
      .from('saves')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', prompt.id);

    const { count: comments } = await supabaseAdmin
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('prompt_id', prompt.id)
      .eq('is_hidden', false);

    return res.status(200).json({
      prompt: {
        ...prompt,
        like_count: likes || 0,
        save_count: saves || 0,
        comment_count: comments || 0
      }
    });
  }

  if (req.method === 'GET' && action === 'by-id') {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'ID required' });
    }

    const { data: prompt, error } = await supabaseAdmin
      .from('prompts')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    return res.status(200).json({ prompt });
  }

  if (req.method === 'GET' && action === 'search') {
    const { q, limit = 20, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (q && q.trim()) {
      const searchTerm = q.trim();
      query = query.or(
        `title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,prompt_text.ilike.%${searchTerm}%`
      );
    }

    const { data: prompts, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const promptsWithCounts = await Promise.all(
      prompts.map(async (prompt) => {
        const { count: likes } = await supabaseAdmin
          .from('likes')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        const { count: saves } = await supabaseAdmin
          .from('saves')
          .select('*', { count: 'exact', head: true })
          .eq('prompt_id', prompt.id);

        return {
          ...prompt,
          like_count: likes || 0,
          save_count: saves || 0
        };
      })
    );

    return res.status(200).json({
      prompts: promptsWithCounts,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  if (req.method === 'GET' && action === 'related') {
    const { promptId, limit = 6 } = req.query;

    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('category_ids')
      .eq('id', promptId)
      .single();

    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    const { data: related, error } = await supabaseAdmin
      .from('prompts')
      .select('*')
      .eq('is_published', true)
      .neq('id', promptId)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const sorted = related.sort((a, b) => {
      const aOverlap = a.category_ids?.filter(id => 
        prompt.category_ids?.includes(id)
      )?.length || 0;
      const bOverlap = b.category_ids?.filter(id => 
        prompt.category_ids?.includes(id)
      )?.length || 0;
      return bOverlap - aOverlap;
    });

    return res.status(200).json({ prompts: sorted });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
