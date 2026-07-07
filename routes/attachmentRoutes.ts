import { Router } from 'express';
import { uploadAttachment } from '../controllers/attachmentController';
import { authenticate } from '../middleware/auth';
import { handleSingleImageUpload } from '../middleware/upload';

const router = Router();

router.post('/attachments/upload', authenticate, handleSingleImageUpload('image'), uploadAttachment);

export default router;
