import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Helper to generate Cloudinary signature
 */
async function generateSignature(params: Record<string, any>, apiSecret: string) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map(key => `${key}=${params[key]}`)
    .join('&') + apiSecret;
  
  const msgUint8 = new TextEncoder().encode(paramString);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  // 1. Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials not set in Edge Function secrets');
    }

    // 2. Get the image from the request
    const imageData = await req.arrayBuffer();
    if (!imageData || imageData.byteLength === 0) {
      throw new Error('No image data received');
    }

    // 3. Prepare Cloudinary Upload
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
      background_removal: 'cloudinary_ai',
      timestamp: timestamp,
    };
    
    const signature = await generateSignature(params, apiSecret);

    const formData = new FormData();
    formData.append('file', new Blob([imageData]));
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('background_removal', 'cloudinary_ai');

    console.log('Uploading to Cloudinary...');

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const result = await uploadResponse.json();
    if (!uploadResponse.ok) {
      throw new Error(`Cloudinary Error: ${result.error?.message || 'Unknown upload error'}`);
    }

    const publicId = result.public_id;
    // Construct the transformation URL for on-the-fly background removal
    // We use .png extension to ensure transparency support
    const processedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/e_background_removal/${publicId}.png`;
    
    console.log('Fetching processed image from:', processedUrl);

    // 4. Fetch the resulting image. 
    // Cloudinary will take a few seconds to process this on the first request.
    const imageResponse = await fetch(processedUrl);
    
    if (!imageResponse.ok) {
      const errText = await imageResponse.text();
      throw new Error(`Processed image fetch failed: ${imageResponse.status} ${errText}`);
    }

    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    
    // Convert to base64
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    return new Response(
      JSON.stringify({ image: `data:image/png;base64,${base64}` }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {

    console.error('Edge Function Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})
