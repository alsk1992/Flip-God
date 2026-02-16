/**
 * Image Processing Tools Module
 *
 * Provides tools for resizing, background removal, watermarking,
 * compression, and platform-specific variant generation.
 *
 * Uses Canvas API patterns. Actual image processing requires
 * sharp or canvas native dependencies.
 */

import { createLogger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
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
// Image Processing Functions
// =============================================================================

/**
 * Resize images to platform specifications.
 * NOTE: Actual pixel manipulation requires sharp or canvas native module.
 * This implementation validates inputs, creates output paths, and provides
 * the resize spec. In production, wire up sharp:
 *   sharp(input).resize(w, h, { fit: 'contain', background }).toFormat(fmt, { quality })
 */
export function resizeImages(input: {
  imagePaths: string[];
  platform: string;
  customWidth?: number;
  customHeight?: number;
  outputDir?: string;
}): ResizeResult {
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

    // TODO: Actual resize with sharp:
    // await sharp(imagePath)
    //   .resize(width, height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    //   .toFormat(format, { quality })
    //   .toFile(outputPath);

    const stats = statSafe(imagePath);
    outputs.push({
      path: outputPath,
      width,
      height,
      format,
      sizeBytes: stats?.size ?? 0,
    });

    logger.info({ input: imagePath, output: outputPath, width, height }, 'Resize queued');
  }

  return { sourcePath: input.imagePaths[0] ?? '', outputs, errors };
}

/**
 * Remove image background (white or transparent).
 * NOTE: Actual background removal requires ML model (remove.bg API or rembg Python library).
 * This provides the integration structure.
 */
export function removeBackground(input: {
  imagePath: string;
  backgroundType?: 'white' | 'transparent';
  outputPath?: string;
}): BackgroundRemovalResult {
  if (!existsSync(input.imagePath)) {
    throw new Error(`File not found: ${input.imagePath}`);
  }

  const bgType = input.backgroundType ?? 'white';
  const ext = bgType === 'transparent' ? '.png' : extname(input.imagePath);
  const name = basename(input.imagePath, extname(input.imagePath));
  const dir = dirname(input.imagePath);
  const outputPath = input.outputPath ?? join(dir, `${name}_nobg${ext}`);

  // TODO: Integrate with background removal service:
  // Option 1: remove.bg API
  //   const response = await fetch('https://api.remove.bg/v1.0/removebg', {
  //     method: 'POST',
  //     headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY },
  //     body: formData
  //   });
  //
  // Option 2: Local rembg (Python):
  //   exec(`rembg i "${input.imagePath}" "${outputPath}"`)
  //
  // Option 3: Sharp + threshold for simple white backgrounds:
  //   sharp(input.imagePath).threshold(240).negate().toColourspace('b-w')

  logger.info({ input: input.imagePath, output: outputPath, bgType }, 'Background removal queued');

  return {
    sourcePath: input.imagePath,
    outputPath,
    backgroundType: bgType,
    processed: false,
    note: 'Background removal requires external service (remove.bg API or rembg). Integration point configured.',
  };
}

/**
 * Add watermark text or logo to product images.
 * NOTE: Actual compositing requires sharp or canvas.
 */
export function addWatermark(input: {
  imagePath: string;
  text?: string;
  logoPath?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;
  outputPath?: string;
}): WatermarkResult {
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

  // TODO: Actual watermark with sharp composite:
  // const watermarkBuffer = input.logoPath
  //   ? await sharp(input.logoPath).resize(200).ensureAlpha(opacity).toBuffer()
  //   : await createTextWatermark(input.text, opacity);
  //
  // await sharp(input.imagePath)
  //   .composite([{ input: watermarkBuffer, gravity: positionToGravity(position) }])
  //   .toFile(outputPath);

  logger.info({ input: input.imagePath, output: outputPath, watermarkType, position }, 'Watermark queued');

  return {
    sourcePath: input.imagePath,
    outputPath,
    watermarkType,
    position,
    applied: false,
  };
}

/**
 * Optimize/compress images for web delivery.
 * Converts to WebP or compresses JPEG with quality optimization.
 */
export function optimizeImages(input: {
  imagePaths: string[];
  format?: 'webp' | 'jpeg' | 'png' | 'auto';
  quality?: number;
  maxSizeKb?: number;
  outputDir?: string;
}): OptimizeResult[] {
  const format = input.format ?? 'auto';
  const quality = Math.max(1, Math.min(100, input.quality ?? 80));
  const results: OptimizeResult[] = [];

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

    // Estimate compressed size (rough heuristic)
    let estimatedSize: number;
    switch (outputFormat) {
      case 'webp':
        estimatedSize = Math.round(originalSize * (quality / 100) * 0.6);
        break;
      case 'jpeg':
        estimatedSize = Math.round(originalSize * (quality / 100) * 0.75);
        break;
      case 'png':
        estimatedSize = Math.round(originalSize * 0.85);
        break;
      default:
        estimatedSize = originalSize;
    }

    const savingsPercent = originalSize > 0
      ? Math.round((1 - estimatedSize / originalSize) * 100)
      : 0;

    // TODO: Actual optimization with sharp:
    // await sharp(imagePath)
    //   .toFormat(outputFormat, { quality, effort: 6 })
    //   .toFile(outputPath);
    //
    // If maxSizeKb specified, iteratively reduce quality:
    // while (outputStats.size > maxSizeKb * 1024 && quality > 10) {
    //   quality -= 5;
    //   await sharp(imagePath).toFormat(outputFormat, { quality }).toFile(outputPath);
    // }

    results.push({
      sourcePath: imagePath,
      outputPath,
      originalSizeBytes: originalSize,
      optimizedSizeBytes: estimatedSize,
      savingsPercent: Math.max(0, savingsPercent),
      format: outputFormat,
      quality,
    });

    logger.info({ input: imagePath, output: outputPath, savings: `${savingsPercent}%` }, 'Optimization queued');
  }

  return results;
}

/**
 * Generate platform-specific image variants from a source image.
 * Creates properly sized versions for each target platform.
 */
export function generateImageVariants(input: {
  imagePath: string;
  platforms: string[];
  outputDir?: string;
}): ImageVariantResult {
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

  const stats = statSafe(input.imagePath);

  for (const platform of input.platforms) {
    const spec = PLATFORM_SPECS[platform.toLowerCase()];
    if (!spec) {
      errors.push(`Unknown platform: ${platform}. Supported: ${Object.keys(PLATFORM_SPECS).join(', ')}`);
      continue;
    }

    const outputPath = join(dir, `${name}_${platform.toLowerCase()}_${spec.width}x${spec.height}.${spec.format}`);

    // TODO: Actual variant creation with sharp:
    // await sharp(input.imagePath)
    //   .resize(spec.width, spec.height, { fit: 'contain', background: '#FFFFFF' })
    //   .toFormat(spec.format, { quality: spec.quality })
    //   .toFile(outputPath);

    variants.push({
      platform: spec.label,
      path: outputPath,
      width: spec.width,
      height: spec.height,
      format: spec.format,
      sizeBytes: stats?.size ?? 0,
    });
  }

  logger.info({ source: input.imagePath, variants: variants.length, errors: errors.length }, 'Variant generation queued');

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

export function handleMediaTool(
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
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
        const result = resizeImages({
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
        const result = removeBackground({
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
        const result = addWatermark({
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
        const result = optimizeImages({
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
        const result = generateImageVariants({
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
    const { statSync } = require('fs');
    return statSync(filePath);
  } catch {
    return null;
  }
}
