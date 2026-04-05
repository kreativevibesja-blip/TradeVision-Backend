import sharp from 'sharp';
import path from 'path';

export async function processChartImage(filePath: string): Promise<string> {
  const ext = path.extname(filePath);
  const processedPath = filePath.replace(ext, `_processed${ext}`);

  await sharp(filePath)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .sharpen()
    .normalize()
    .toFile(processedPath);

  return processedPath;
}

export async function generateThumbnail(filePath: string): Promise<string> {
  const ext = path.extname(filePath);
  const thumbPath = filePath.replace(ext, `_thumb${ext}`);

  await sharp(filePath)
    .resize(400, 225, { fit: 'cover' })
    .toFile(thumbPath);

  return thumbPath;
}
