// app/api/save-beta-user/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { email } = await request.json();

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  // Initialize Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase environment variables are not set');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const { error } = await supabase
      .from('beta_users')
      .insert([{ email: email }]);

    if (error) {
      // Gracefully handle unique constraint violation (email already exists)
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Email already registered' }, { status: 200 });
      }
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'Failed to save beta user' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Beta user saved successfully' }, { status: 200 });

  } catch (error) {
    console.error('Save beta user API error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
