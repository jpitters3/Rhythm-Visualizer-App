// Follow this setup guide to test the Edge Function:
// 1. Install Supabase CLI: https://supabase.com/docs/guides/resources/supabase-cli
// 2. Login: supabase login
// 3. Link project: supabase link --project-ref ycdlqkaymkgpbpgtqubs
// 4. Set Secret: supabase secrets set GEMINI_API_KEY=your_key_here
// 5. Deploy: supabase functions deploy ai-assistant

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { systemPrompt } = await req.json()
    console.log("Supabase Function: Received Prompt Length:", systemPrompt?.length)

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      console.error("Supabase Function: GEMINI_API_KEY is missing!")
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not set on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    console.log("Supabase Function: Calling Gemini API...");

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }]
      })
    });

    const result = await geminiResponse.json();
    console.log("Supabase Function: Gemini Response Status:", geminiResponse.status);

    if (result.error) {
      console.error("Supabase Function: Gemini Error:", result.error);
      return new Response(
        JSON.stringify({ error: result.error.message || 'Gemini API Error', details: result.error }),
        { status: geminiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error("Supabase Function: Catch Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
