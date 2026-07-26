import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Check if env vars exist
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      return res.status(500).json({ 
        error: 'Supabase credentials missing',
        hasUrl: !!url,
        hasKey: !!key
      });
    }

    // Initialize Supabase
    const supabase = createClient(url, key);

    // Simple test query
    const { data, error } = await supabase.from('users').select('count', { count: 'exact' });

    if (error) {
      return res.status(500).json({ 
        error: 'Supabase query failed',
        details: error.message,
        hint: error.hint || 'Check if tables exist'
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Supabase connected successfully',
      count: data
    });

  } catch (error) {
    return res.status(500).json({ 
      error: 'Unexpected error',
      message: error.message,
      stack: error.stack
    });
  }
}
