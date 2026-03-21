import { randomUUID } from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  countOpenTickets,
  createTicketRecord,
  getUserById,
  listAdminTicketsPage,
  listTicketsForUser,
  updateTicketRecord,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../lib/supabase';

const TICKET_CATEGORIES: TicketCategory[] = ['ACCOUNT', 'BILLING', 'ANALYSIS', 'BUG', 'FEATURE', 'GENERAL'];
const TICKET_PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'];

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const sanitizeWhatsAppNumber = (value: unknown) => {
  const normalized = normalizeText(value).replace(/[^\d+]/g, '');
  return normalized.length >= 7 ? normalized : null;
};

const createTicketNumber = () => `TV-${Date.now().toString().slice(-6)}-${randomUUID().slice(0, 4).toUpperCase()}`;

const mapTicket = (ticket: Awaited<ReturnType<typeof createTicketRecord>>) => ({
  ...ticket,
  canReplyByWhatsApp: Boolean(ticket.whatsappNumber),
  canReplyByEmail: Boolean(ticket.userEmail),
});

export const getOpenTicketCount = async (_req: AuthRequest, res: Response) => {
  try {
    const count = await countOpenTickets();
    return res.json({ count });
  } catch (error) {
    console.error('Get open ticket count error:', error);
    return res.status(500).json({ error: 'Failed to count tickets' });
  }
};

export const createTicket = async (req: AuthRequest, res: Response) => {
  try {
    const subject = normalizeText(req.body.subject);
    const message = normalizeText(req.body.message);
    const category = normalizeText(req.body.category).toUpperCase() as TicketCategory;
    const priority = normalizeText(req.body.priority).toUpperCase() as TicketPriority;

    if (!subject || subject.length < 5) {
      return res.status(400).json({ error: 'Subject must be at least 5 characters' });
    }

    if (!message || message.length < 20) {
      return res.status(400).json({ error: 'Message must be at least 20 characters' });
    }

    if (!TICKET_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid ticket category' });
    }

    if (!TICKET_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: 'Invalid ticket priority' });
    }

    const user = await getUserById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ticket = await createTicketRecord({
      ticketNumber: createTicketNumber(),
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      whatsappNumber: sanitizeWhatsAppNumber(req.body.whatsappNumber),
      subject,
      category,
      priority,
      message,
    });

    return res.status(201).json({ ticket: mapTicket(ticket) });
  } catch (error) {
    console.error('Create ticket error:', error);
    return res.status(500).json({ error: 'Failed to create ticket' });
  }
};

export const getMyTickets = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const { tickets, total } = await listTicketsForUser(req.user!.id, page, limit);

    return res.json({
      tickets: tickets.map(mapTicket),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get my tickets error:', error);
    return res.status(500).json({ error: 'Failed to retrieve tickets' });
  }
};

export const getAdminTickets = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = normalizeText(req.query.status).toUpperCase() as TicketStatus;
    const priority = normalizeText(req.query.priority).toUpperCase() as TicketPriority;
    const dateRange = normalizeText(req.query.dateRange) as '7d' | '30d' | '90d' | 'all';
    const search = normalizeText(req.query.search);

    const { tickets, total } = await listAdminTicketsPage(page, limit, {
      ...(search ? { search } : {}),
      ...(TICKET_STATUSES.includes(status) ? { status } : {}),
      ...(TICKET_PRIORITIES.includes(priority) ? { priority } : {}),
      ...(dateRange === '7d' || dateRange === '30d' || dateRange === '90d' || dateRange === 'all' ? { dateRange } : {}),
    });

    return res.json({
      tickets: tickets.map(mapTicket),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get admin tickets error:', error);
    return res.status(500).json({ error: 'Failed to retrieve tickets' });
  }
};

export const updateAdminTicket = async (req: AuthRequest, res: Response) => {
  try {
    const status = normalizeText(req.body.status).toUpperCase() as TicketStatus;
    const hasAdminNotes = Object.prototype.hasOwnProperty.call(req.body, 'adminNotes');
    const hasAdminResponse = Object.prototype.hasOwnProperty.call(req.body, 'adminResponse');
    const adminNotes = normalizeText(req.body.adminNotes);
    const adminResponse = normalizeText(req.body.adminResponse);

    if (status && !TICKET_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid ticket status' });
    }

    const nextStatus = status || undefined;
    const resolvedLike = nextStatus === 'RESOLVED' || nextStatus === 'CLOSED';

    const ticket = await updateTicketRecord(req.params.id, {
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(hasAdminNotes ? { adminNotes: adminNotes || null } : {}),
      ...(hasAdminResponse ? { adminResponse: adminResponse || null } : {}),
      ...(hasAdminResponse ? { respondedAt: adminResponse ? new Date().toISOString() : null } : {}),
      ...(resolvedLike ? { closedAt: new Date().toISOString() } : nextStatus ? { closedAt: null } : {}),
    });

    return res.json({ ticket: mapTicket(ticket) });
  } catch (error) {
    console.error('Update admin ticket error:', error);
    return res.status(500).json({ error: 'Failed to update ticket' });
  }
};