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
  let userId = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch (err) {
      // Token invalid, but we allow GET requests
    }
  }

  const { action } = req.query;

  // --- LIST COMMENTS ---
  if (req.method === 'GET' && action === 'list') {
    const { promptId, limit = 20, offset = 0 } = req.query;

    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID required' });
    }

    const { data: comments, error, count } = await supabaseAdmin
      .from('comments')
      .select(`
        id,
        user_id,
        content,
        likes_count,
        created_at,
        updated_at,
        profiles:user_id (
          id,
          username,
          display_name,
          avatar_url,
          is_premium,
          is_owner
        )
      `, { count: 'exact' })
      .eq('prompt_id', promptId)
      .eq('is_hidden', false)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const commentsWithReplies = await Promise.all(
      comments.map(async (comment) => {
        const { data: replies } = await supabaseAdmin
          .from('comments')
          .select(`
            id,
            user_id,
            content,
            likes_count,
            created_at,
            updated_at,
            profiles:user_id (
              id,
              username,
              display_name,
              avatar_url,
              is_premium,
              is_owner
            )
          `)
          .eq('parent_id', comment.id)
          .eq('is_hidden', false)
          .order('created_at', { ascending: true });

        let liked = false;
        if (userId) {
          const { data: like } = await supabaseAdmin
            .from('comment_likes')
            .select('id')
            .eq('user_id', userId)
            .eq('comment_id', comment.id)
            .maybeSingle();
          liked = !!like;
        }

        return {
          ...comment,
          replies: replies || [],
          liked
        };
      })
    );

    return res.status(200).json({
      comments: commentsWithReplies,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  // --- ADD COMMENT ---
  if (req.method === 'POST' && action === 'add') {
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { promptId, content, parentId } = req.body;

    if (!promptId || !content || content.trim() === '') {
      return res.status(400).json({ error: 'Prompt ID and content required' });
    }

    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('id, is_published')
      .eq('id', promptId)
      .single();

    if (!prompt || !prompt.is_published) {
      return res.status(404).json({ error: 'Prompt not found or unpublished' });
    }

    if (parentId) {
      const { data: parent } = await supabaseAdmin
        .from('comments')
        .select('id')
        .eq('id', parentId)
        .eq('is_hidden', false)
        .single();

      if (!parent) {
        return res.status(404).json({ error: 'Parent comment not found' });
      }
    }

    const { data: comment, error } = await supabaseAdmin
      .from('comments')
      .insert({
        user_id: userId,
        prompt_id: promptId,
        parent_id: parentId || null,
        content: content.trim()
      })
      .select(`
        id,
        user_id,
        content,
        likes_count,
        created_at,
        updated_at,
        profiles:user_id (
          id,
          username,
          display_name,
          avatar_url,
          is_premium,
          is_owner
        )
      `)
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // ✅ FIX: Atomic increment for comment_count
    const { error: updateError } = await supabaseAdmin
      .from('prompts')
      .update({ comment_count: supabaseAdmin.raw('comment_count + 1') })
      .eq('id', promptId);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(201).json({
      success: true,
      comment
    });
  }

  // --- DELETE COMMENT ---
  if (req.method === 'DELETE' && action === 'delete') {
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { commentId } = req.query;

    if (!commentId) {
      return res.status(400).json({ error: 'Comment ID required' });
    }

    const { data: comment } = await supabaseAdmin
      .from('comments')
      .select('user_id, prompt_id, parent_id')
      .eq('id', commentId)
      .single();

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_owner')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.is_owner || false;

    if (comment.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    // Admin: hide instead of delete
    if (isAdmin && comment.user_id !== userId) {
      const { error } = await supabaseAdmin
        .from('comments')
        .update({ is_hidden: true })
        .eq('id', commentId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        message: 'Comment hidden by admin'
      });
    }

    // Regular user: delete permanently
    const { error } = await supabaseAdmin
      .from('comments')
      .delete()
      .eq('id', commentId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // ✅ FIX: Atomic decrement with safety check
    const { error: updateError } = await supabaseAdmin
      .from('prompts')
      .update({ comment_count: supabaseAdmin.raw('GREATEST(0, comment_count - 1)') })
      .eq('id', comment.prompt_id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Comment deleted'
    });
  }

  // --- LIKE COMMENT ---
  if (req.method === 'POST' && action === 'like-comment') {
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { commentId } = req.body;

    if (!commentId) {
      return res.status(400).json({ error: 'Comment ID required' });
    }

    const { data: comment } = await supabaseAdmin
      .from('comments')
      .select('id, likes_count')
      .eq('id', commentId)
      .single();

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const { data: existing } = await supabaseAdmin
      .from('comment_likes')
      .select('id')
      .eq('user_id', userId)
      .eq('comment_id', commentId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Already liked this comment' });
    }

    const { error } = await supabaseAdmin
      .from('comment_likes')
      .insert({
        user_id: userId,
        comment_id: commentId
      });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabaseAdmin
      .from('comments')
      .update({ likes_count: comment.likes_count + 1 })
      .eq('id', commentId);

    return res.status(201).json({
      success: true,
      action: 'liked',
      likes_count: comment.likes_count + 1
    });
  }

  // --- UNLIKE COMMENT ---
  if (req.method === 'DELETE' && action === 'unlike-comment') {
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { commentId } = req.query;

    if (!commentId) {
      return res.status(400).json({ error: 'Comment ID required' });
    }

    const { data: comment } = await supabaseAdmin
      .from('comments')
      .select('id, likes_count')
      .eq('id', commentId)
      .single();

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const { data: existing } = await supabaseAdmin
      .from('comment_likes')
      .select('id')
      .eq('user_id', userId)
      .eq('comment_id', commentId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'You have not liked this comment' });
    }

    const { error } = await supabaseAdmin
      .from('comment_likes')
      .delete()
      .eq('user_id', userId)
      .eq('comment_id', commentId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabaseAdmin
      .from('comments')
      .update({ likes_count: comment.likes_count - 1 })
      .eq('id', commentId);

    return res.status(200).json({
      success: true,
      action: 'unliked',
      likes_count: comment.likes_count - 1
    });
  }

  // --- COMMENTS BY USER ---
  if (req.method === 'GET' && action === 'by-user') {
    const { targetUserId, limit = 20, offset = 0 } = req.query;
    const id = targetUserId || userId;

    if (!id) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const { data: comments, error, count } = await supabaseAdmin
      .from('comments')
      .select(`
        id,
        prompt_id,
        content,
        likes_count,
        created_at,
        updated_at,
        prompts:prompt_id (
          id,
          slug,
          title,
          image_main
        )
      `, { count: 'exact' })
      .eq('user_id', id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      comments,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
