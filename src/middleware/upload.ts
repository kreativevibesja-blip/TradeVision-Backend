import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import fs from 'fs';
import type { NextFunction, Request, Response } from 'express';
import { logUploadError, type UploadErrorType } from '../lib/supabase';

const uploadDir = path.join(process.cwd(), config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const MAX_CHART_UPLOAD_BYTES = Math.min(config.upload.maxFileSize, 5 * 1024 * 1024);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext) && ALLOWED_IMAGE_MIME_TYPES.has((file.mimetype || '').toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('INVALID_TYPE'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_CHART_UPLOAD_BYTES },
});

const mapUploadError = (error: unknown): { errorType: UploadErrorType; message: string; status: number } => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return {
      errorType: 'FILE_TOO_LARGE',
      message: 'File is too large. Please upload an image under 5MB.',
      status: 400,
    };
  }

  if (error instanceof Error && error.message === 'INVALID_TYPE') {
    return {
      errorType: 'INVALID_TYPE',
      message: 'That file type isn’t supported. Please upload a PNG or JPG screenshot.',
      status: 400,
    };
  }

  return {
    errorType: 'READ_ERROR',
    message: 'There was an issue reading the file. Please try again.',
    status: 400,
  };
};

export const handleChartUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.fields([{ name: 'chart', maxCount: 1 }, { name: 'chart2', maxCount: 1 }])(req, res, async (error) => {
    if (!error) {
      next();
      return;
    }

    const mapped = mapUploadError(error);
    const userId = typeof (req as Request & { user?: { id?: string } }).user?.id === 'string'
      ? (req as Request & { user?: { id?: string } }).user!.id!
      : null;

    await logUploadError({
      userId,
      errorType: mapped.errorType,
      fileType: typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : null,
      fileSize: null,
      source: 'chart-upload-api',
      stage: 'multer',
      message: error instanceof Error ? error.message : mapped.message,
      metadata: {
        route: req.originalUrl,
      },
    });

    res.status(mapped.status).json({ error: mapped.message, errorType: mapped.errorType });
  });
};
