import { Router } from 'express';
import { heartbeatVisitor } from '../controllers/presenceController';

const router = Router();

router.post('/visitors/heartbeat', heartbeatVisitor);

export default router;