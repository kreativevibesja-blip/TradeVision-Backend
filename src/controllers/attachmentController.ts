import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { config } from '../config';
import { supabase } from '../lib/supabase';

const folderForContext = (value: unknown) => {
  const context = typeof value === 'string' ? value.toLowerCase().trim() : 'general';
  if (['feed', 'community', 'messages', 'journal', 'support'].includes(context)) {
    return context;
  }
  return 'general';
};

export const uploadAttachment = async (req: Request, res: Response) => {
  const imageFile = (req as Request & { file?: Express.Multer.File }).file;

  try {
    if (!imageFile) {
      return res.status(400).json({ error: 'Image file is required.' });
    }

    const extension = path.extname(imageFile.originalname || imageFile.filename || '').toLowerCase() || '.png';
    const objectPath = `attachments/${folderForContext(req.body?.context)}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
    const fileBuffer = await fs.readFile(imageFile.path);

    const { error: uploadError } = await supabase.storage.from(config.supabase.storageBucket).upload(objectPath, fileBuffer, {
      contentType: imageFile.mimetype || 'application/octet-stream',
      upsert: false,
    });

    if (!uploadError) {
      const { data } = supabase.storage.from(config.supabase.storageBucket).getPublicUrl(objectPath);
      return res.json({ imageUrl: data.publicUrl });
    }

    console.warn('[attachments] storage upload failed, falling back to local upload:', uploadError.message);
    return res.json({ imageUrl: `${req.protocol}://${req.get('host')}/uploads/${imageFile.filename}` });
  } catch (error) {
    console.error('[attachments] upload failed:', error);
    return res.status(500).json({ error: 'Failed to upload attachment' });
  } finally {
    if (imageFile?.path) {
      await fs.unlink(imageFile.path).catch(() => undefined);
    }
  }
};
