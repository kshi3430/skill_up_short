/**
 * JSON2Video video generation module
 * Uses JSON2Video API to generate videos from scene descriptions and images
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const API_KEY = process.env.JSON2VIDEO_API_KEY;
const API_BASE_URL = 'https://api.json2video.com/v2';

/**
 * Generate video using JSON2Video API
 * @param {Object} params
 * @param {Array} params.scenes - Scene array with text descriptions
 * @param {Array} params.images - Image URLs array for scenes
 * @returns {Promise<Object>} - { success, videoDataUrl, projectId, duration }
 */
export async function generateVideoWithJson2Video({ scenes, images }) {
  try {
    if (!API_KEY) {
      throw new Error('JSON2VIDEO_API_KEY not configured');
    }

    if (!scenes || scenes.length === 0 || !images || images.length === 0) {
      throw new Error('Missing scenes or images');
    }

    // Build JSON2Video movie structure
    const moviePayload = await buildMoviePayload(scenes, images);

    // Submit rendering job
    console.log('Submitting JSON2Video rendering job...');
    const submitResponse = await fetch(`${API_BASE_URL}/movies`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(moviePayload),
    });

    if (!submitResponse.ok) {
      throw new Error(`JSON2Video API error: ${submitResponse.status}`);
    }

    const submitData = await submitResponse.json();
    if (!submitData.success || !submitData.project) {
      throw new Error('JSON2Video submission failed');
    }

    // Return placeholder - client will poll for status
    return {
      success: true,
      videoDataUrl: `data:video/mp4;base64,cGxhY2Vob2xkZXItdmlkZW8=`,
      projectId: submitData.project,
      isProcessing: true,
    };
  } catch (error) {
    console.error('JSON2Video error:', error.message);
    throw error;
  }
}

/**
 * Build JSON2Video movie payload from scenes and images
 * @param {Array} scenes - Scene array with text descriptions
 * @param {Array} images - Image URLs array for scenes
 * @returns {Promise<Object>} - JSON2Video movie object
 */
async function buildMoviePayload(scenes, images) {
  const movieScenes = [];
  
  for (let index = 0; index < Math.min(scenes.length, 4); index++) {
    const scene = scenes[index];
    const elements = [];

    // Add image if available
    if (images && images[index]) {
      // Handle both URL strings and image objects
      const imageUrl = typeof images[index] === 'string' ? images[index] : images[index].imageDataUrl;
      if (imageUrl) {
        elements.push({
          type: 'image',
          src: imageUrl,
          duration: 5,
          resize: 'fill',
        });
      }
    }

    // Generate narration voice using OpenAI TTS
    const narration = scene.narration || scene.text || '';
    if (narration) {
      try {
        const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: narration,
            voice: 'nova',
            response_format: 'mp3',
          }),
        });

        if (ttsResponse.ok) {
          const audioBuffer = await ttsResponse.arrayBuffer();
          const audioBase64 = Buffer.from(audioBuffer).toString('base64');
          const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
          
          elements.push({
            type: 'audio',
            src: audioUrl,
            duration: -1,
          });
        }
      } catch (error) {
        console.warn('TTS generation failed, skipping audio:', error.message);
      }
    }

    if (elements.length > 0) {
      movieScenes.push({ elements });
    }
  }

  return {
    resolution: 'instagram-story',
    scenes: movieScenes,
  };
}

/**
 * Download video from URL and return as buffer
 * @param {string} videoUrl - URL to download
 * @returns {Promise<Buffer>} - Video buffer
 */
async function downloadVideo(videoUrl) {
  const response = await fetch(videoUrl);

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Check video rendering status (for polling in frontend)
 * @param {string} projectId - JSON2Video project ID
 * @returns {Promise<Object>} - Status information
 */
export async function checkVideoStatus(projectId) {
  try {
    if (!API_KEY) {
      throw new Error('JSON2VIDEO_API_KEY environment variable not set');
    }

    const response = await fetch(`${API_BASE_URL}/movies?project=${projectId}`, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to check status: ${response.status}`);
    }

    const data = await response.json();

    return {
      success: data.success,
      status: data.movie?.status,
      url: data.movie?.url,
      duration: data.movie?.duration,
      message: data.movie?.message,
    };
  } catch (error) {
    console.error('Error checking video status:', error.message);
    throw error;
  }
}
