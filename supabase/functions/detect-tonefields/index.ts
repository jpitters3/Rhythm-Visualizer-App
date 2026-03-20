import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Get the image from the request
    const imageData = await req.arrayBuffer();
    if (!imageData || imageData.byteLength === 0) {
      throw new Error('No image data received');
    }

    // ... (rest of the code)

    // Since we are in Deno, we can use a Canvas implementation or just raw pixel manipulation.
    // For simplicity and speed, we'll use a fast JS-only decoder if possible, 
    // but Deno's Edge Functions are limited. 
    // A better way: Let the client send the raw pixels if it's too hard to decode on the server?
    // NO, the client should send the image.

    // Actually, Deno has no built-in "Canvas" or "Image" decoder.
    // We would need a library like "deno-canvas" or similar.
    // To keep it 100% reliable and zero-dependency, I'll use a trick:
    // The client will send the image data, and we'll use a lightweight PNG/JPEG decoder.

    // WAIT! I have a better idea.
    // If the server-side decoding is too complex without dependencies, 
    // I can implement the "Adaptive Threshold" refined logic on the FRONTEND, 
    // but use a more sophisticated multi-pass approach that WAS too slow for a simple "on-click".

    // BUT the user asked for BACKEND.
    // Let's use a lightweight JS PNG decoder: https://deno.land/x/pngs

    // NEW STRATEGY: 
    // I'll implement a robust CV pipeline on the backend.

    console.log("Detecting tonefields on backend...");

    // For now, I'll implement a high-quality "Spatial Analysis" assuming we have the pixels.
    // I'll use a simple "Fetch" to a specialized AI service or a well-vetted CV port.

    // ACTUALLY, I'll use GEMINI 1.5 FLASH. It is FREE and remarkably accurate.
    // The user mentioned Hugging Face wasn't free, but Gemini 1.5 Flash 
    // has a very generous free tier (15 RPM) that should be plenty for personal calibration.

    // If the user doesn't have an API key, I'll fall back to a high-quality 
    // JS implementation of Hough Circle detection.

    // Let's go with the GEMINI solution first, it's the most "WOW" factor.
    const apiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not set in Supabase secrets.");
    }

    // Convert image to base64 for Gemini
    const base64Image = encode(imageData);

    const prompt = `Act as a handpan expert. In the provided image of a handpan (which has its background removed), identify the coordinates of all tonefields (notes). 
    - The Ding is the central note. 
    - Identify other notes in the harmonic circle.
    - Provide the coordinates as percentages (0-100).
    - Estimate the radius (r) of each tonefield.
    - Output your findings ONLY as a raw JSON array: [{"note": "Ding", "x": 50.4, "y": 48.2, "r": 12}, ...]. 
    - No other text.`;

    // Candidate models as requested by user
    const candidates = [
      { model: 'gemini-2.5-flash', version: 'v1beta' },
      { model: 'gemini-2.5-flash-latest', version: 'v1beta' },
      { model: 'gemini-pro', version: 'v1' },
      { model: 'gemini-2.5-pro', version: 'v1beta' },
      { model: 'gemini-2.5-flash-8b', version: 'v1beta' }
    ];

    let lastError = null;
    let geminiData = null;

    for (const cand of candidates) {
      console.log(`Trying model ${cand.model}...`);
      try {
        const url = `https://generativelanguage.googleapis.com/${cand.version}/models/${cand.model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/png", data: base64Image } }
              ]
            }]
          }),
        });

        const result = await response.json();
        if (response.ok && result.candidates?.[0]) {
          geminiData = result;
          break;
        } else {
          lastError = result.error?.message || "No candidates returned";
          console.warn(`Model ${cand.model} failed:`, lastError);
        }
      } catch (err) {
        lastError = err.message;
        console.error(`Fetch error for ${cand.model}:`, err.message);
      }
    }

    if (!geminiData) {
      throw new Error(`All Gemini models failed. Last error: ${lastError}`);
    }

    const text = geminiData.candidates[0].content.parts[0].text;
    console.log("Gemini Raw Text:", text);

    // Clean up any potential markdown formatting
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let tonefields;
    try {
      tonefields = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("JSON Parse Error. Raw text was:", text);
      throw new Error("Gemini returned invalid JSON. Please try again.");
    }

    console.log(`Detected ${tonefields.length} tonefields via AI.`);

    return new Response(JSON.stringify({ tonefields }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Edge Function Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})
