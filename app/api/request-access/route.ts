import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    // Basic email validation
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    try {
      // Check if email already exists
      const { data: existingEmail, error: checkError } = await supabaseAdmin
        .from('access_requests')
        .select('email')
        .eq('email', email)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 means no rows returned, which is what we want for new emails
        console.error('Error checking existing email:', checkError);
        return NextResponse.json({ 
          error: 'Database error' 
        }, { status: 500 });
      }

      if (existingEmail) {
        return NextResponse.json({ 
          success: true, 
          message: 'Email already registered for access' 
        });
      }

      // Insert the email into the database
      const { error: insertError } = await supabaseAdmin
        .from('access_requests')
        .insert([{ email }]);

      if (insertError) {
        console.error('Error inserting email:', insertError);
        return NextResponse.json({ 
          error: 'Failed to save email request' 
        }, { status: 500 });
      }

      console.log('Access request saved:', email);

      return NextResponse.json({ 
        success: true, 
        message: 'Access request submitted successfully' 
      });

    } catch (dbError: any) {
      console.error('Database error:', dbError);
      return NextResponse.json({ 
        error: 'Database error' 
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('Error processing access request:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
} 