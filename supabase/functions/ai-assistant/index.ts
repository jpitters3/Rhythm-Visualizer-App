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

    const candidates = [
      { model: 'gemini-2.5-flash-preview-05-20', version: 'v1beta' },
      { model: 'gemini-2.5-flash',               version: 'v1beta' },
      { model: 'gemini-2.0-flash',               version: 'v1beta' },
      { model: 'gemini-2.0-flash-lite',          version: 'v1beta' },
      { model: 'gemini-1.5-flash',               version: 'v1beta' },
      { model: 'gemini-1.5-flash-latest',        version: 'v1beta' },
    ];

    let lastError = null;
    let result = null;
    let finalStatus = 200;

    for (const cand of candidates) {
      const url = `https://generativelanguage.googleapis.com/${cand.version}/models/${cand.model}:generateContent?key=${apiKey}`;
      console.log(`Supabase Function: Trying model ${cand.model} (${cand.version})...`);

      try {
        const geminiResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }]
          })
        });

        const data = await geminiResponse.json();
        finalStatus = geminiResponse.status;

        if (geminiResponse.ok && !data.error) {
          console.log(`Supabase Function: Success with ${cand.model}`);
          result = data;
          break; // Success!
        } else {
          lastError = data.error || { message: 'Unknown error' };
          console.warn(`Supabase Function: Model ${cand.model} failed with ${finalStatus}:`, lastError.message);
          
          // If it's something other than quota (429) or not found (404), maybe we should stop?
          // Actually, let's keep trying other models regardless of the error type to be safe.
          continue; 
        }
      } catch (err: any) {
        console.error(`Supabase Function: Fetch error for ${cand.model}:`, err.message);
        lastError = { message: err.message };
        continue;
      }
    }

    if (!result) {
      console.error("Supabase Function: All models failed. Last error:", lastError);
      return new Response(
        JSON.stringify({ 
          error: lastError?.message || 'All Gemini models failed', 
          details: lastError,
          triedModels: candidates.map(c => c.model)
        }),
        { status: finalStatus || 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
