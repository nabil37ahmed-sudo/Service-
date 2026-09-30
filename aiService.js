// ============================================================================
// AI SERVICE LAYER
// ----------------------------------------------------------------------------
// This file is the ONLY place that talks to AI providers. Every function is
// intentionally small and single-purpose so a provider can be swapped out
// later (e.g. a different vision model, or a real image-editing API) without
// touching routing/server code or the frontend.
//
//   analyzeFace(imageDataUrl)
//   getHairstyleRecommendations(analysis)
//   getBeardRecommendations(analysis)
//   getGroomingGuide(analysis)
//   generateHairstylePreview(imageDataUrl, hairstyleName)
//   generateBeardPreview(imageDataUrl, beardStyleName)
//
// No function here ever invents or randomizes a result. If a provider is not
// configured, functions throw a typed error (see errors.js) that the route
// layer turns into a clear, honest message for the user.
// ============================================================================

const https = require('https');
const { AppError } = require('./errors');

const ANALYSIS_MODEL = 'claude-sonnet-4-6'; // vision-capable Claude model
const ANTHROPIC_API_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 30000;

// Image-editing provider. "gemini" (Google's Gemini 2.5 Flash Image) is the
// only provider implemented so far, since it supports image-in/image-out
// editing over a plain REST call with just an API key. Defaults to "gemini"
// so setting IMAGE_EDIT_API_KEY alone is enough to turn the feature on.
const IMAGE_EDIT_PROVIDER = (process.env.IMAGE_EDIT_PROVIDER || 'gemini').toLowerCase();
const IMAGE_EDIT_MODEL = process.env.IMAGE_EDIT_MODEL || 'gemini-2.5-flash-image';
const IMAGE_EDIT_TIMEOUT_MS = 45000;

function isAnalysisProviderConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function isImageEditProviderConfigured() {
  return Boolean(process.env.IMAGE_EDIT_API_KEY);
}

/** Splits a "data:image/jpeg;base64,...." string into media type + raw base64. */
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new AppError('INVALID_IMAGE', 'That does not look like a valid image file.');
  }
  const match = dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!match) {
    throw new AppError('INVALID_IMAGE', 'Please upload a JPEG, PNG, or WEBP image.');
  }
  const mediaType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  return { mediaType, base64: match[3] };
}

function estimateBytesFromBase64(base64) {
  return Math.floor((base64.length * 3) / 4);
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

/** Shared low-level POST to the Anthropic Messages API. */
function callClaude(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new AppError('PROVIDER_NOT_CONFIGURED', "AI analysis isn't connected yet. Add your AI API key to enable live analysis."));
      return;
    }

    const payload = JSON.stringify({ model: ANALYSIS_MODEL, max_tokens: 1200, messages });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 429) {
            reject(new AppError('RATE_LIMITED', "We're getting a lot of requests right now. Please try again in a moment."));
            return;
          }
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new AppError('PROVIDER_AUTH_FAILED', 'The AI provider rejected the request. Please check the server configuration.'));
            return;
          }
          if (res.statusCode >= 500) {
            reject(new AppError('PROVIDER_UNAVAILABLE', 'The AI service is temporarily unavailable. Please try again shortly.'));
            return;
          }
          if (res.statusCode >= 400) {
            reject(new AppError('PROVIDER_ERROR', 'The AI provider could not process this request.'));
            return;
          }
          try {
            const json = JSON.parse(body);
            const textBlock = (json.content || []).find((b) => b.type === 'text');
            if (!textBlock) {
              reject(new AppError('PROVIDER_ERROR', 'The AI provider returned an unexpected response.'));
              return;
            }
            resolve(extractJson(textBlock.text));
          } catch (err) {
            reject(new AppError('PROVIDER_ERROR', 'The AI provider returned a response we could not understand.'));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new AppError('PROVIDER_TIMEOUT', 'The AI service took too long to respond. Please try again.'));
    });
    req.on('error', () => {
      reject(new AppError('NETWORK_ERROR', 'We could not reach the AI service. Please check your connection and try again.'));
    });

    req.write(payload);
    req.end();
  });
}

// ----------------------------------------------------------------------------
// 1. analyzeFace
// ----------------------------------------------------------------------------
const ANALYSIS_INSTRUCTIONS = `
You are assisting a grooming/hairstyle app. Look carefully at the uploaded photo and respond with STRICT JSON ONLY (no markdown, no commentary, no code fences) matching exactly this shape:

{
  "faceDetected": boolean,
  "multipleFaces": boolean,
  "issueMessage": string | null,
  "faceShape": "Oval" | "Round" | "Square" | "Oblong" | "Heart" | "Diamond" | null,
  "confidence": "Low" | "Moderate" | "High" | null,
  "faceShapeReasoning": string | null,
  "lengthToWidthImpression": string | null,
  "foreheadProportion": string | null,
  "cheekboneProminence": string | null,
  "jawlineShape": string | null,
  "chinShape": string | null,
  "hairlineAppearance": string | null,
  "currentHairstyleDescription": string | null,
  "facialHairStatus": string | null
}

Rules:
- If no face is clearly visible, set faceDetected=false and give a short, kind issueMessage explaining why (e.g. lighting, angle, obstruction), and set all other fields to null.
- If more than one face is clearly visible, set multipleFaces=true with an issueMessage explaining a single, clear face is needed, and set the shape/analysis fields to null.
- Otherwise set faceDetected=true, multipleFaces=false, issueMessage=null, and fill in every other field.
- These are visual ESTIMATES from a photo, not medical or scientific measurements. Never state exact numeric measurements. Describe proportions in plain, relative, neutral language (e.g. "appears slightly longer than wide").
- Be neutral and non-judgmental. Never describe a feature as unattractive, flawed, or in need of correction.
- faceShapeReasoning should be 1-2 short sentences explaining, in plain language, why you estimated that shape based on what is visible.
- Respond with ONLY the JSON object, nothing else.
`.trim();

async function analyzeFace(imageDataUrl) {
  const { mediaType, base64 } = parseDataUrl(imageDataUrl);

  const MAX_BYTES = 8 * 1024 * 1024; // 8MB
  if (estimateBytesFromBase64(base64) > MAX_BYTES) {
    throw new AppError('IMAGE_TOO_LARGE', 'That image is too large. Please upload a photo under 8MB.');
  }

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: ANALYSIS_INSTRUCTIONS },
      ],
    },
  ];

  const result = await callClaude(messages);

  if (!result || typeof result.faceDetected !== 'boolean') {
    throw new AppError('PROVIDER_ERROR', 'The AI provider returned a response we could not understand.');
  }
  if (!result.faceDetected) {
    throw new AppError('FACE_NOT_DETECTED', result.issueMessage || 'We could not clearly detect a face in this photo. Please try a clearer, front-facing selfie with good lighting.');
  }
  if (result.multipleFaces) {
    throw new AppError('MULTIPLE_FACES', result.issueMessage || 'This photo appears to show more than one face. Please upload a photo with just yourself.');
  }

  return result;
}

// ----------------------------------------------------------------------------
// 2 & 3. getHairstyleRecommendations / getBeardRecommendations
// ----------------------------------------------------------------------------
const HAIRSTYLE_CATEGORIES = [
  'Low taper', 'Mid taper', 'High taper', 'Textured crop', 'French crop',
  'Curtains', 'Side part', 'Messy fringe', 'Crew cut', 'Buzz cut', 'Quiff',
];
const BEARD_CATEGORIES = [
  'Clean shave', 'Light stubble', 'Heavy stubble', 'Short boxed beard', 'Goatee', 'Full beard',
];

function buildRecommendationInstructions({ analysis, kind, categories, count }) {
  return `
You are a grooming stylist assistant. Based ONLY on the following AI-estimated facial analysis (these are estimates, not medical facts), recommend exactly ${count} ${kind} styles that would plausibly suit this person.

Analysis:
${JSON.stringify(analysis, null, 2)}

Choose only from (or close variants of) this list where sensible: ${categories.join(', ')}.
Do not recommend all of them automatically — pick the ones that genuinely fit the estimated face shape, hairline, current hairstyle/facial hair, and proportions described above. Do not repeat styles.

Respond with STRICT JSON ONLY, an array of exactly ${count} objects, no markdown, no commentary:
[
  {
    "name": string,
    "why": string,
    "maintenance": "Low" | "Medium" | "High"
  }
]
`.trim();
}

async function getHairstyleRecommendations(analysis) {
  const instructions = buildRecommendationInstructions({ analysis, kind: 'hairstyle', categories: HAIRSTYLE_CATEGORIES, count: 5 });
  const result = await callClaude([{ role: 'user', content: instructions }]);
  if (!Array.isArray(result) || result.length === 0) {
    throw new AppError('PROVIDER_ERROR', 'Could not generate hairstyle recommendations right now.');
  }
  return result;
}

async function getBeardRecommendations(analysis) {
  const instructions = buildRecommendationInstructions({ analysis, kind: 'beard', categories: BEARD_CATEGORIES, count: 4 });
  const result = await callClaude([{ role: 'user', content: instructions }]);
  if (!Array.isArray(result) || result.length === 0) {
    throw new AppError('PROVIDER_ERROR', 'Could not generate beard recommendations right now.');
  }
  return result;
}

// ----------------------------------------------------------------------------
// 4. getGroomingGuide — deterministic, rule-based (no AI call, no invented
//    facts). Built only from fields already present in the real analysis.
// ----------------------------------------------------------------------------
function getGroomingGuide(analysis) {
  const hairLength = (analysis.currentHairstyleDescription || '').toLowerCase();
  const beardStatus = (analysis.facialHairStatus || '').toLowerCase();

  const looksShort = /short|buzz|crop|crew|fade|taper/.test(hairLength);
  const looksLong = /long|shoulder|flow/.test(hairLength);
  const hasBeard = /beard|stubble|goatee/.test(beardStatus) && !/clean|shaven|shave/.test(beardStatus);

  return {
    hair: {
      suggestedFrequency: looksShort
        ? 'Roughly every 3-4 weeks to keep the shape crisp.'
        : looksLong
        ? 'Roughly every 6-8 weeks, with trims as needed to manage split ends.'
        : 'Roughly every 4-6 weeks, adjusted to how fast your hair grows.',
      stylingApproach: 'Use a small amount of product suited to your hair type (matte clay for texture, light pomade for shine/control) and style while hair is slightly damp for more control.',
      generalMaintenance: 'Wash with a gentle shampoo 2-3 times a week — over-washing can dry out both hair and scalp.',
    },
    beard: hasBeard
      ? {
          suggestedLengthOrStyle: "Keep the current length consistent; uneven growth is easiest to manage with a guarded trimmer.",
          necklineCheeklineGuidance: "Define the neckline just above the Adam's apple and clean up the cheek line gradually rather than cutting a hard edge all at once.",
        }
      : {
          suggestedLengthOrStyle: 'If you want to grow facial hair, allow at least 2-3 weeks of even growth before shaping it.',
          necklineCheeklineGuidance: 'If clean-shaven, light exfoliation before shaving can reduce irritation and razor bumps.',
        },
    skin: {
      tips: [
        'Cleanse gently once or twice a day rather than scrubbing.',
        'Moisturize daily, especially after shaving or washing.',
        'Use sunscreen during the day if you will be outdoors.',
      ],
      note: 'This is general non-medical advice only. See a dermatologist for any specific skin concerns.',
    },
    appearance: {
      tips: [
        'General fitness and posture both influence how facial features and jawline read in photos and in person.',
        'A well-shaped beard or hairstyle can visually balance facial proportions more than either alone.',
        'Lighting and camera angle make a noticeable difference in photos — soft, front-facing light is usually most flattering.',
      ],
      note: 'Facial exercises or grooming will not change underlying bone structure. These are appearance and styling tips only.',
    },
  };
}

// ----------------------------------------------------------------------------
// 5 & 6. generateHairstylePreview / generateBeardPreview
// ----------------------------------------------------------------------------
// No identity-preserving image-editing provider is wired into this first
// version — that typically requires a separate, paid image-editing API.
// These functions are written so a real provider can be dropped in later:
// build the prompt, call the provider, return the resulting image. Until
// then they throw a clear "not configured" error rather than ever
// fabricating an image.

function buildHairstylePrompt(hairstyleName) {
  return `Preserve the person's identity, facial structure, skin tone, facial proportions and camera perspective. Modify primarily the hairstyle to match: ${hairstyleName}. Do not redesign the person's face. Do not change their identity. Make the result photorealistic.`;
}

function buildBeardPrompt(beardStyleName) {
  return `Preserve the person's identity and facial structure. Modify primarily the facial hair to create: ${beardStyleName}. Keep the face, skin, eyes, nose, mouth and proportions unchanged. Produce a realistic result.`;
}

async function generateHairstylePreview(imageDataUrl, hairstyleName) {
  parseDataUrl(imageDataUrl); // validates the image before checking config
  if (!isImageEditProviderConfigured()) {
    throw new AppError('PREVIEW_NOT_CONFIGURED', 'The hairstyle preview service is not connected yet. This feature needs an image-editing AI provider to be configured on the server.');
  }
  return callImageEditProvider({ imageDataUrl, prompt: buildHairstylePrompt(hairstyleName) });
}

async function generateBeardPreview(imageDataUrl, beardStyleName) {
  parseDataUrl(imageDataUrl);
  if (!isImageEditProviderConfigured()) {
    throw new AppError('PREVIEW_NOT_CONFIGURED', 'The beard preview service is not connected yet. This feature needs an image-editing AI provider to be configured on the server.');
  }
  return callImageEditProvider({ imageDataUrl, prompt: buildBeardPrompt(beardStyleName) });
}

/**
 * Dispatches to the configured image-editing provider. Add another `case`
 * here (and a corresponding `callXProvider` function) to support a
 * different provider — nothing else in the app needs to change.
 */
async function callImageEditProvider({ imageDataUrl, prompt }) {
  switch (IMAGE_EDIT_PROVIDER) {
    case 'gemini':
      return callGeminiImageEdit({ imageDataUrl, prompt });
    default:
      throw new AppError(
        'PREVIEW_NOT_IMPLEMENTED',
        `No integration is implemented for image-edit provider "${IMAGE_EDIT_PROVIDER}". Supported: gemini.`
      );
  }
}

/**
 * Google Gemini 2.5 Flash Image ("nano banana") — supports image-in,
 * image-out editing over a single REST call. Docs:
 * https://ai.google.dev/gemini-api/docs/image-generation
 *
 * Returns a "data:<mime>;base64,<data>" string the frontend can drop
 * straight into an <img> tag, or throws an AppError.
 */
function callGeminiImageEdit({ imageDataUrl, prompt }) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.IMAGE_EDIT_API_KEY;
    if (!apiKey) {
      reject(new AppError('PREVIEW_NOT_CONFIGURED', 'The style preview service is not connected yet.'));
      return;
    }

    let mediaType, base64;
    try {
      ({ mediaType, base64 } = parseDataUrl(imageDataUrl));
    } catch (err) {
      reject(err);
      return;
    }

    const payload = JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType: mediaType, data: base64 } },
            { text: prompt },
          ],
        },
      ],
    });

    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${encodeURIComponent(IMAGE_EDIT_MODEL)}:generateContent`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: IMAGE_EDIT_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 429) {
            reject(new AppError('RATE_LIMITED', "We're getting a lot of preview requests right now. Please try again in a moment."));
            return;
          }
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new AppError('PROVIDER_AUTH_FAILED', 'The image preview provider rejected the request. Please check the server configuration.'));
            return;
          }
          if (res.statusCode >= 500) {
            reject(new AppError('PROVIDER_UNAVAILABLE', 'The image preview service is temporarily unavailable. Please try again shortly.'));
            return;
          }
          if (res.statusCode >= 400) {
            let message = 'The image preview provider could not process this request.';
            try {
              const errJson = JSON.parse(body);
              if (errJson && errJson.error && errJson.error.message) {
                // Surface the provider's own message but never raw internals/keys.
                message = 'The image preview provider could not process this request: ' + errJson.error.message;
              }
            } catch (_) { /* keep default message */ }
            reject(new AppError('PROVIDER_ERROR', message));
            return;
          }

          try {
            const json = JSON.parse(body);
            const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
            const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);
            if (!imagePart) {
              // The model responded but declined to produce an image (e.g. safety
              // filters, or it only returned text). Do not fake a result.
              const textPart = parts.find((p) => p.text);
              reject(new AppError(
                'PREVIEW_GENERATION_FAILED',
                textPart
                  ? `The preview could not be generated: ${textPart.text}`.slice(0, 300)
                  : 'The preview service did not return an image for this photo. Please try a different photo or style.'
              ));
              return;
            }
            const outMime = imagePart.inlineData.mimeType || 'image/png';
            resolve(`data:${outMime};base64,${imagePart.inlineData.data}`);
          } catch (err) {
            reject(new AppError('PROVIDER_ERROR', 'The image preview provider returned a response we could not understand.'));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new AppError('PROVIDER_TIMEOUT', 'The preview took too long to generate. Please try again.'));
    });
    req.on('error', () => {
      reject(new AppError('NETWORK_ERROR', 'We could not reach the image preview service. Please check your connection and try again.'));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  analyzeFace,
  getHairstyleRecommendations,
  getBeardRecommendations,
  getGroomingGuide,
  generateHairstylePreview,
  generateBeardPreview,
  isAnalysisProviderConfigured,
  isImageEditProviderConfigured,
};
