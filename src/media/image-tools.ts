/**
 * Image Processing Tools Module
 *
 * Provides tools for resizing, background removal, watermarking,
 * compression, and platform-specific variant generation.
 *
 * Uses sharp for actual image processing (dynamic import, optional dependency).
 */

import { createLogger } from '../utils/logger.js';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, basename, extname, dirname } from 'path';

const logger = createLogger('media-image-tools');

// =============================================================================
// Types
// =============================================================================

export interface ImageSpec {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  label: string;
}

export interface ResizeResult {
  sourcePath: string;
  outputs: Array<{
    path: string;
    width: number;
    height: number;
    format: string;
    sizeBytes: number;
  }>;
  errors: string[];
}

export interface BackgroundRemovalResult {
  sourcePath: string;
  outputPath: string;
  backgroundType: 'white' | 'transparent';
  processed: boolean;
  note: string;
}

export interface WatermarkResult {
  sourcePath: string;
  outputPath: string;
  watermarkType: 'text' | 'logo';
  position: string;
  applied: boolean;
}

export interface OptimizeResult {
  sourcePath: string;
  outputPath: string;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  savingsPercent: number;
  format: string;
  quality: number;
}

export interface ImageVariantResult {
  sourcePath: string;
  variants: Array<{
    platform: string;
    path: string;
    width: number;
    height: number;
    format: string;
    sizeBytes: number;
  }>;
  errors: string[];
}

// =============================================================================
// Platform Image Specs
// =============================================================================

const PLATFORM_SPECS: Record<string, ImageSpec> = {
  ebay: { width: 1600, height: 1600, format: 'jpeg', quality: 90, label: 'eBay' },
  amazon: { width: 2000, height: 2000, format: 'jpeg', quality: 95, label: 'Amazon' },
  etsy: { width: 2000, height: 2000, format: 'jpeg', quality: 85, label: 'Etsy' },
  poshmark: { width: 1200, height: 1200, format: 'jpeg', quality: 85, label: 'Poshmark' },
  mercari: { width: 1080, height: 1080, format: 'jpeg', quality: 85, label: 'Mercari' },
  shopify: { width: 2048, height: 2048, format: 'png', quality: 90, label: 'Shopify' },
  facebook: { width: 1200, height: 1200, format: 'jpeg', quality: 85, label: 'Facebook Marketplace' },
  thumbnail: { width: 400, height: 400, format: 'webp', quality: 80, label: 'Thumbnail' },
};

// =============================================================================
// Sharp loader helper
// =============================================================================

async function loadSharp(): Promise<any> {
  try {
    const mod = await import('sharp');
    return mod.default ?? mod;
  } catch {
    throw new Error(
      'sharp is not installed. Install it with: npm install sharp\n' +
      'sharp is an optional dependency for image processing. ' +
      'Without it, image tools cannot perform actual pixel manipulation.'
    );
  }
}

// =============================================================================
// Image Processing Functions
// =============================================================================

/**
 * Resize images to platform specifications using sharp.
 */
export async function resizeImages(input: {
  imagePaths: string[];
  platform: string;
  customWidth?: number;
  customHeight?: number;
  outputDir?: string;
}): Promise<ResizeResult> {
  const spec = PLATFORM_SPECS[input.platform.toLowerCase()];
  if (!spec && !input.customWidth) {
    throw new Error(
      `Unknown platform: ${input.platform}. Supported: ${Object.keys(PLATFORM_SPECS).join(', ')}. Or provide custom_width/custom_height.`
    );
  }

  const width = input.customWidth ?? spec?.width ?? 1600;
  const height = input.customHeight ?? spec?.height ?? 1600;
  const format = spec?.format ?? 'jpeg';
  const quality = spec?.quality ?? 90;

  const outputs: ResizeResult['outputs'] = [];
  const errors: string[] = [];

  let sharp: Awaited<ReturnType<typeof loadSharp>>;
  try {
    sharp = await loadSharp();
  } catch (err) {
    return {
      sourcePath: input.imagePaths[0] ?? '',
      outputs: [],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  for (const imagePath of input.imagePaths) {
    if (!existsSync(imagePath)) {
      errors.push(`File not found: ${imagePath}`);
      continue;
    }

    const dir = input.outputDir ?? dirname(imagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const name = basename(imagePath, extname(imagePath));
    const outputPath = join(dir, `${name}_${width}x${height}.${format}`);

    try {
      let pipeline = sharp(imagePath).resize(width, height, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      });

      if (format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality });
      } else if (format === 'png') {
        pipeline = pipeline.png({ quality });
      } else if (format === 'webp') {
        pipeline = pipeline.webp({ quality });
      }

      await pipeline.toFile(outputPath);

      const stats = statSafe(outputPath);
      outputs.push({
        path: outputPath,
        width,
        height,
        format,
        sizeBytes: stats?.size ?? 0,
      });

      logger.info({ input: imagePath, output: outputPath, width, height }, 'Image resized');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to resize ${imagePath}: ${msg}`);
      logger.error({ input: imagePath, error: msg }, 'Resize failed');
    }
  }

  return { sourcePath: input.imagePaths[0] ?? '', outputs, errors };
}

/**
 * Remove image background by making white/near-white pixels transparent.
 * Uses sharp raw pixel manipulation with a configurable threshold.
 */
export async function removeBackground(input: {
  imagePath: string;
  backgroundType?: 'white' | 'transparent';
  outputPath?: string;
}): Promise<BackgroundRemovalResult> {
  if (!existsSync(input.imagePath)) {
    throw new Error(`File not found: ${input.imagePath}`);
  }

  const bgType = input.backgroundType ?? 'white';
  const ext = bgType === 'transparent' ? '.png' : extname(input.imagePath);
  const name = basename(input.imagePath, extname(input.imagePath));
  const dir = dirname(input.imagePath);
  const outputPath = input.outputPath ?? join(dir, `${name}_nobg${ext}`);

  let sharp: Awaited<ReturnType<typeof loadSharp>>;
  try {
    sharp = await loadSharp();
  } catch (err) {
    return {
      sourcePath: input.imagePath,
      outputPath,
      backgroundType: bgType,
      processed: false,
      note: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    if (bgType === 'transparent') {
      // Convert white/near-white pixels to transparent using raw pixel data
      const image = sharp(input.imagePath).ensureAlpha();
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

      const threshold = 240; // Pixels with R, G, B all >= threshold are considered "white"
      const pixels = Buffer.from(data);

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        if (r >= threshold && g >= threshold && b >= threshold) {
          pixels[i + 3] = 0; // Set alpha to 0 (transparent)
        }
      }

      await sharp(pixels, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .png()
        .toFile(outputPath);
    } else {
      // White background: flatten with white background and output
      await sharp(input.imagePath)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 95 })
        .toFile(outputPath);
    }

    logger.info({ input: input.imagePath, output: outputPath, bgType }, 'Background processed');

    return {
      sourcePath: input.imagePath,
      outputPath,
      backgroundType: bgType,
      processed: true,
      note: bgType === 'transparent'
        ? 'White/near-white pixels (R,G,B >= 240) converted to transparent. For complex backgrounds, consider a dedicated ML service like remove.bg.'
        : 'Image flattened with white background.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ input: input.imagePath, error: msg }, 'Background removal failed');
    return {
      sourcePath: input.imagePath,
      outputPath,
      backgroundType: bgType,
      processed: false,
      note: `Background removal failed: ${msg}`,
    };
  }
}

/**
 * Add watermark text or logo to product images using sharp composite.
 */
export async function addWatermark(input: {
  imagePath: string;
  text?: string;
  logoPath?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;
  outputPath?: string;
}): Promise<WatermarkResult> {
  if (!existsSync(input.imagePath)) {
    throw new Error(`File not found: ${input.imagePath}`);
  }
  if (!input.text && !input.logoPath) {
    throw new Error('Either text or logo_path must be provided');
  }
  if (input.logoPath && !existsSync(input.logoPath)) {
    throw new Error(`Logo file not found: ${input.logoPath}`);
  }

  const position = input.position ?? 'bottom-right';
  const opacity = Math.max(0, Math.min(1, input.opacity ?? 0.3));
  const name = basename(input.imagePath, extname(input.imagePath));
  const ext = extname(input.imagePath);
  const dir = dirname(input.imagePath);
  const outputPath = input.outputPath ?? join(dir, `${name}_watermarked${ext}`);
  const watermarkType = input.text ? 'text' : 'logo';

  let sharp: Awaited<ReturnType<typeof loadSharp>>;
  try {
    sharp = await loadSharp();
  } catch (err) {
    return {
      sourcePath: input.imagePath,
      outputPath,
      watermarkType,
      position,
      applied: false,
    };
  }

  try {
    // Map position string to sharp gravity
    const gravityMap: Record<string, string> = {
      'top-left': 'northwest',
      'top-right': 'northeast',
      'bottom-left': 'southwest',
      'bottom-right': 'southeast',
      'center': 'centre',
    };
    const gravity = gravityMap[position] ?? 'southeast';

    // Get source image metadata for sizing the watermark
    const metadata = await sharp(input.imagePath).metadata();
    const imgWidth = metadata.width ?? 800;
    const imgHeight = metadata.height ?? 800;

    let watermarkBuffer: Buffer;

    if (input.logoPath) {
      // Logo watermark: resize logo and apply opacity
      const logoSize = Math.round(Math.min(imgWidth, imgHeight) * 0.2);
      watermarkBuffer = await sharp(input.logoPath)
        .resize(logoSize, logoSize, { fit: 'inside' })
        .ensureAlpha()
        .composite([{
          input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in',
        }])
        .toBuffer();
    } else {
      // Text watermark: create SVG text overlay
      const text = input.text ?? 'Watermark';
      const fontSize = Math.max(16, Math.round(Math.min(imgWidth, imgHeight) * 0.04));
      const padding = Math.round(fontSize * 0.5);
      // Estimate text width (rough: 0.6 * fontSize per char)
      const textWidth = Math.round(text.length * fontSize * 0.6) + padding * 2;
      const textHeight = fontSize + padding * 2;
      const alphaHex = hex2(Math.round(opacity * 255));

      const svgText = `<svg width="${textWidth}" height="${textHeight}" xmlns="http://www.w3.org/2000/svg">
        <text x="${padding}" y="${fontSize + padding * 0.5}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fontSize}"
          fill="#ffffff${alphaHex}"
          stroke="#000000${alphaHex}"
          stroke-width="1">${escapeXml(text)}</text>
      </svg>`;

      watermarkBuffer = Buffer.from(svgText);
    }

    await sharp(input.imagePath)
      .composite([{
        input: watermarkBuffer,
        gravity: gravity as any,
      }])
      .toFile(outputPath);

    logger.info({ input: input.imagePath, output: outputPath, watermarkType, position }, 'Watermark applied');

    return {
      sourcePath: input.imagePath,
      outputPath,
      watermarkType,
      position,
      applied: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ input: input.imagePath, error: msg }, 'Watermark failed');
    return {
      sourcePath: input.imagePath,
      outputPath,
      watermarkType,
      position,
      applied: false,
    };
  }
}

/**
 * Optimize/compress images for web delivery using sharp.
 * Converts to WebP or compresses JPEG with quality optimization.
 */
export async function optimizeImages(input: {
  imagePaths: string[];
  format?: 'webp' | 'jpeg' | 'png' | 'auto';
  quality?: number;
  maxSizeKb?: number;
  outputDir?: string;
}): Promise<OptimizeResult[]> {
  const format = input.format ?? 'auto';
  const quality = Math.max(1, Math.min(100, input.quality ?? 80));
  const results: OptimizeResult[] = [];

  let sharp: Awaited<ReturnType<typeof loadSharp>>;
  try {
    sharp = await loadSharp();
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'sharp not available');
    return results;
  }

  for (const imagePath of input.imagePaths) {
    if (!existsSync(imagePath)) {
      logger.warn({ path: imagePath }, 'File not found, skipping');
      continue;
    }

    const stats = statSafe(imagePath);
    const originalSize = stats?.size ?? 0;

    // Determine output format
    let outputFormat = format;
    if (outputFormat === 'auto') {
      outputFormat = originalSize > 500_000 ? 'webp' : 'jpeg';
    }

    const name = basename(imagePath, extname(imagePath));
    const dir = input.outputDir ?? dirname(imagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const outputPath = join(dir, `${name}_optimized.${outputFormat}`);

    try {
      let currentQuality = quality;
      const pipeline = sharp(imagePath).rotate(); // auto-rotate based on EXIF

      // Apply format-specific compression
      if (outputFormat === 'webp') {
        await pipeline.webp({ quality: currentQuality, effort: 6 }).toFile(outputPath);
      } else if (outputFormat === 'jpeg') {
        await pipeline.jpeg({ quality: currentQuality, mozjpeg: true }).toFile(outputPath);
      } else if (outputFormat === 'png') {
        await pipeline.png({ quality: currentQuality, compressionLevel: 9 }).toFile(outputPath);
      }

      // If maxSizeKb specified, iteratively reduce quality to meet target
      if (input.maxSizeKb != null) {
        const maxBytes = input.maxSizeKb * 1024;
        let outputStats = statSafe(outputPath);
        while (outputStats && outputStats.size > maxBytes && currentQuality > 10) {
          currentQuality -= 5;
          const retryPipeline = sharp(imagePath).rotate();
          if (outputFormat === 'webp') {
            await retryPipeline.webp({ quality: currentQuality, effort: 6 }).toFile(outputPath);
          } else if (outputFormat === 'jpeg') {
            await retryPipeline.jpeg({ quality: currentQuality, mozjpeg: true }).toFile(outputPath);
          } else if (outputFormat === 'png') {
            await retryPipeline.png({ quality: currentQuality, compressionLevel: 9 }).toFile(outputPath);
          }
          outputStats = statSafe(outputPath);
        }
      }

      const finalStats = statSafe(outputPath);
      const optimizedSize = finalStats?.size ?? 0;
      const savingsPercent = originalSize > 0
        ? Math.round((1 - optimizedSize / originalSize) * 100)
        : 0;

      results.push({
        sourcePath: imagePath,
        outputPath,
        originalSizeBytes: originalSize,
        optimizedSizeBytes: optimizedSize,
        savingsPercent: Math.max(0, savingsPercent),
        format: outputFormat,
        quality: currentQuality,
      });

      logger.info({ input: imagePath, output: outputPath, savings: `${savingsPercent}%` }, 'Image optimized');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ input: imagePath, error: msg }, 'Optimization failed');
    }
  }

  return results;
}

/**
 * Generate platform-specific image variants from a source image using sharp.
 * Creates properly sized versions for each target platform.
 */
export async function generateImageVariants(input: {
  imagePath: string;
  platforms: string[];
  outputDir?: string;
}): Promise<ImageVariantResult> {
  if (!existsSync(input.imagePath)) {
    throw new Error(`File not found: ${input.imagePath}`);
  }

  const variants: ImageVariantResult['variants'] = [];
  const errors: string[] = [];
  const name = basename(input.imagePath, extname(input.imagePath));
  const dir = input.outputDir ?? join(dirname(input.imagePath), 'variants');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let sharp: Awaited<ReturnType<typeof loadSharp>>;
  try {
    sharp = await loadSharp();
  } catch (err) {
    return {
      sourcePath: input.imagePath,
      variants: [],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  for (const platform of input.platforms) {
    const spec = PLATFORM_SPECS[platform.toLowerCase()];
    if (!spec) {
      errors.push(`Unknown platform: ${platform}. Supported: ${Object.keys(PLATFORM_SPECS).join(', ')}`);
      continue;
    }

    const outputPath = join(dir, `${name}_${platform.toLowerCase()}_${spec.width}x${spec.height}.${spec.format}`);

    try {
      let pipeline = sharp(input.imagePath).resize(spec.width, spec.height, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      });

      if (spec.format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: spec.quality });
      } else if (spec.format === 'png') {
        pipeline = pipeline.png({ quality: spec.quality });
      } else if (spec.format === 'webp') {
        pipeline = pipeline.webp({ quality: spec.quality });
      }

      await pipeline.toFile(outputPath);

      const outputStats = statSafe(outputPath);
      variants.push({
        platform: spec.label,
        path: outputPath,
        width: spec.width,
        height: spec.height,
        format: spec.format,
        sizeBytes: outputStats?.size ?? 0,
      });

      logger.info({ platform, output: outputPath }, 'Variant created');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to create ${platform} variant: ${msg}`);
      logger.error({ platform, error: msg }, 'Variant creation failed');
    }
  }

  logger.info({ source: input.imagePath, variants: variants.length, errors: errors.length }, 'Variant generation complete');

  return {
    sourcePath: input.imagePath,
    variants,
    errors,
  };
}

// =============================================================================
// Tool Definitions
// =============================================================================

export const mediaTools = [
  {
    name: 'resize_images',
    description: 'Bulk resize product images to platform-specific dimensions. Supports eBay (1600x1600), Amazon (2000x2000), Etsy, Poshmark, Mercari, Shopify, Facebook Marketplace, and custom sizes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image_paths: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Array of image file paths to resize',
        },
        platform: {
          type: 'string' as const,
          enum: ['ebay', 'amazon', 'etsy', 'poshmark', 'mercari', 'shopify', 'facebook', 'thumbnail'],
          description: 'Target platform for size specs',
        },
        custom_width: { type: 'number' as const, description: 'Custom width in pixels (overrides platform spec)' },
        custom_height: { type: 'number' as const, description: 'Custom height in pixels (overrides platform spec)' },
        output_dir: { type: 'string' as const, description: 'Output directory (default: same as source)' },
      },
      required: ['image_paths', 'platform'] as const,
    },
  },
  {
    name: 'remove_background',
    description: 'Remove image background for clean product photos. Supports white background (for marketplaces) or transparent (for compositing).',
    input_schema: {
      type: 'object' as const,
      properties: {
        image_path: { type: 'string' as const, description: 'Path to the image file' },
        background_type: {
          type: 'string' as const,
          enum: ['white', 'transparent'],
          description: 'Background type: white for marketplace listings, transparent for compositing (default: white)',
        },
        output_path: { type: 'string' as const, description: 'Output file path (default: auto-generated)' },
      },
      required: ['image_path'] as const,
    },
  },
  {
    name: 'add_watermark',
    description: 'Add watermark text or logo to product images for brand protection or social media.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image_path: { type: 'string' as const, description: 'Path to the image file' },
        text: { type: 'string' as const, description: 'Watermark text (e.g., store name, URL)' },
        logo_path: { type: 'string' as const, description: 'Path to logo image for watermark' },
        position: {
          type: 'string' as const,
          enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'],
          description: 'Watermark position (default: bottom-right)',
        },
        opacity: { type: 'number' as const, description: 'Watermark opacity 0-1 (default: 0.3)' },
        output_path: { type: 'string' as const, description: 'Output file path (default: auto-generated)' },
      },
      required: ['image_path'] as const,
    },
  },
  {
    name: 'optimize_images',
    description: 'Compress and optimize product images for web. Converts to WebP for best compression or optimizes JPEG quality. Reduces file size while maintaining visual quality.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image_paths: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Array of image file paths to optimize',
        },
        format: {
          type: 'string' as const,
          enum: ['webp', 'jpeg', 'png', 'auto'],
          description: 'Output format. "auto" picks WebP for large files, JPEG otherwise (default: auto)',
        },
        quality: { type: 'number' as const, description: 'Quality 1-100 (default: 80)' },
        max_size_kb: { type: 'number' as const, description: 'Max file size in KB. Will iteratively reduce quality to meet target.' },
        output_dir: { type: 'string' as const, description: 'Output directory (default: same as source)' },
      },
      required: ['image_paths'] as const,
    },
  },
  {
    name: 'generate_image_variants',
    description: 'Generate platform-specific image variants from a single source image. Creates properly sized, formatted versions for each marketplace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image_path: { type: 'string' as const, description: 'Path to source image' },
        platforms: {
          type: 'array' as const,
          items: {
            type: 'string' as const,
            enum: ['ebay', 'amazon', 'etsy', 'poshmark', 'mercari', 'shopify', 'facebook', 'thumbnail'],
          },
          description: 'Target platforms to generate variants for',
        },
        output_dir: { type: 'string' as const, description: 'Output directory for variants (default: ./variants/ next to source)' },
      },
      required: ['image_path', 'platforms'] as const,
    },
  },
] as const;

// =============================================================================
// Handler
// =============================================================================

export async function handleMediaTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    switch (toolName) {
      case 'resize_images': {
        const imagePaths = input.image_paths as string[];
        const platform = input.platform as string;
        if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
          return { success: false, error: 'image_paths must be a non-empty array' };
        }
        if (!platform) {
          return { success: false, error: 'platform is required' };
        }
        const result = await resizeImages({
          imagePaths,
          platform,
          customWidth: input.custom_width as number | undefined,
          customHeight: input.custom_height as number | undefined,
          outputDir: input.output_dir as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'remove_background': {
        const imagePath = input.image_path as string;
        if (!imagePath) return { success: false, error: 'image_path is required' };
        const result = await removeBackground({
          imagePath,
          backgroundType: input.background_type as 'white' | 'transparent' | undefined,
          outputPath: input.output_path as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'add_watermark': {
        const imagePath = input.image_path as string;
        if (!imagePath) return { success: false, error: 'image_path is required' };
        if (!input.text && !input.logo_path) {
          return { success: false, error: 'Either text or logo_path must be provided' };
        }
        const result = await addWatermark({
          imagePath,
          text: input.text as string | undefined,
          logoPath: input.logo_path as string | undefined,
          position: input.position as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | undefined,
          opacity: input.opacity as number | undefined,
          outputPath: input.output_path as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'optimize_images': {
        const imagePaths = input.image_paths as string[];
        if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
          return { success: false, error: 'image_paths must be a non-empty array' };
        }
        const result = await optimizeImages({
          imagePaths,
          format: input.format as 'webp' | 'jpeg' | 'png' | 'auto' | undefined,
          quality: input.quality as number | undefined,
          maxSizeKb: input.max_size_kb as number | undefined,
          outputDir: input.output_dir as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'generate_image_variants': {
        const imagePath = input.image_path as string;
        const platforms = input.platforms as string[];
        if (!imagePath) return { success: false, error: 'image_path is required' };
        if (!Array.isArray(platforms) || platforms.length === 0) {
          return { success: false, error: 'platforms must be a non-empty array' };
        }
        const result = await generateImageVariants({
          imagePath,
          platforms,
          outputDir: input.output_dir as string | undefined,
        });
        return { success: true, data: result };
      }

      default:
        return { success: false, error: `Unknown media tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function statSafe(filePath: string): { size: number } | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
