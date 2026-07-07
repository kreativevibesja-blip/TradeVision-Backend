import { Router } from 'express';
import { addToRadar, getRadar, removeFromRadar } from '../controllers/radarController';
import { authenticate, requireTopTier } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireTopTier);

router.post('/add', addToRadar);
router.get('/', getRadar);
router.delete('/:id', removeFromRadar);

export default router;
