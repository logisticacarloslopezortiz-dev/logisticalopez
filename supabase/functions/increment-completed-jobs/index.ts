import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// IMPORTANT: Replace with your actual Supabase URL and anon key
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { userId } = await req.json();

    if (!userId) {
      return new Response('User ID is required', { status: 400 });
    }

    // This function must be created in your database
    const { error } = await supabase.rpc('increment_completed_jobs', { user_id: userId });

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify({ message: 'Completed jobs incremented successfully' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
