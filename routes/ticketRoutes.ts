import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { createTicket, getMyTickets } from '../controllers/ticketController';

const router = Router();

router.use(authenticate);

router.post('/', createTicket);
router.get('/mine', getMyTickets);

export default router;